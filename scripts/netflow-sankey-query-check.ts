import assert from 'node:assert/strict';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { filtersToQuery, parseQuery } from '@hyperdx/common-utils/dist/filters';
import {
  Filter,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

import {
  buildNetflowQueryConfigs,
  NetflowFilters,
} from '../packages/app/src/netflow';
import {
  buildNetflowSankeyConfig,
  buildNetflowSankeyData,
  SankeyDimension,
  sankeyDimensionExpression,
} from '../packages/app/src/netflowSankey';

async function main() {
  const client = new ClickhouseClient({
    host: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    attribution: { surface: 'dashboard', label: 'netflow-sankey-verification' },
  });
  const source: TNetflowSource = {
    id: 'netflow-demo',
    kind: SourceKind.Netflow,
    name: 'NetFlow demo',
    connection: 'netflow-local',
    from: { databaseName: 'netflow_demo', tableName: 'flows' },
    timestampValueExpression: 'TimeReceived',
    defaultTableSelectExpression: '*',
    bytesExpression: 'Bytes',
    packetsExpression: 'Packets',
    samplingRateExpression: 'SamplingRate',
    srcAddrExpression: 'SrcAddr',
    dstAddrExpression: 'DstAddr',
    srcPortExpression: 'SrcPort',
    dstPortExpression: 'DstPort',
    protocolExpression: 'Proto',
    exporterExpression: 'ExporterName',
    inIfExpression: 'InIfName',
    outIfExpression: 'OutIfName',
  };
  const canonical: SankeyDimension[] = [
    { key: 'srcAS', label: 'Source AS', expression: 'SrcAS' },
    {
      key: 'connectivity',
      label: 'Input connectivity',
      expression: 'InIfConnectivity',
    },
    { key: 'provider', label: 'Input provider', expression: 'InIfProvider' },
    { key: 'exporter', label: 'Exporter', expression: 'ExporterName' },
  ];
  const canonicalSql = [
    'toString(SrcAS)',
    'InIfConnectivity',
    'InIfProvider',
    'ExporterName',
  ];
  try {
    const [bounds] = await (
      await client.query({
        query:
          'SELECT toUnixTimestamp(min(TimeReceived)) AS start, toUnixTimestamp(max(TimeReceived)) + 1 AS end, count() AS records FROM netflow_demo.flows',
        format: 'JSONEachRow',
      })
    ).json<{ start: number; end: number; records: string }>();
    assert.ok(Number(bounds.records) > 0, 'Seed NetFlow before verification');
    const dateRange: [Date, Date] = [
      new Date(bounds.start * 1000),
      new Date(bounds.end * 1000),
    ];
    const seconds = bounds.end - bounds.start;
    const metadata = getMetadata(client);

    async function verify({
      label,
      dimensions = canonical,
      sqlDimensions = canonicalSql,
      limit = 20,
      mappedSource = source,
      where = '',
      filters = {},
      extraFilters = [],
      predicate = '1',
    }: {
      label: string;
      dimensions?: SankeyDimension[];
      sqlDimensions?: string[];
      limit?: number;
      mappedSource?: TNetflowSource;
      where?: string;
      filters?: NetflowFilters;
      extraFilters?: Filter[];
      predicate?: string;
    }) {
      const baseConfig = buildNetflowQueryConfigs({
        source: mappedSource,
        dateRange,
        where,
        filters,
        extraFilters,
      }).totalBytes;
      const config = buildNetflowSankeyConfig({
        baseConfig,
        dimensions,
        limit,
      });
      assert.equal(config.where, where);
      assert.deepEqual(config.filters, baseConfig.filters);
      assert.deepEqual(config.dateRange, dateRange);
      const result = await client.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const graph = buildNetflowSankeyData(result.data, dimensions);
      assert.ok(graph.paths.length > 0, label);
      const aliases = sqlDimensions.map((_, index) => `d${index}`);
      const sql = `SELECT ${sqlDimensions.map((expression, index) => `${expression} AS d${index}`).join(', ')},
        sum(Bytes * SamplingRate) AS bytes FROM netflow_demo.flows
        WHERE TimeReceived >= toDateTime(${bounds.start}) AND TimeReceived < toDateTime(${bounds.end})
        AND (${predicate}) GROUP BY ${aliases.join(', ')} ORDER BY bytes DESC LIMIT ${limit}`;
      const expected = await (
        await client.query({ query: sql, format: 'JSONEachRow' })
      ).json<Record<string, string>>();
      const expectedPaths = expected.map(row => ({
        values: aliases.map(alias => row[alias]),
        value: Number(row.bytes),
      }));
      const byValues = (a: { values: string[] }, b: { values: string[] }) =>
        JSON.stringify(a.values).localeCompare(JSON.stringify(b.values));
      assert.deepEqual(
        [...graph.paths].sort(byValues),
        expectedPaths.sort(byValues),
        label,
      );
      const [rate] = await (
        await client.query({
          query: `SELECT sum(bytes) AS total_bytes, sum(bytes) * 8 / ${seconds} AS bps FROM (${sql})`,
          format: 'JSONEachRow',
        })
      ).json<{ total_bytes: string; bps: number }>();
      assert.equal(graph.totalBytes, Number(rate.total_bytes), label);
      assert.equal(
        (graph.totalBytes * 8) / seconds,
        rate.bps,
        `${label}: average bitrate`,
      );
      for (let stage = 0; stage < dimensions.length - 1; stage++) {
        const links = graph.links.filter(
          link => graph.nodes[link.source].stage === stage,
        );
        assert.equal(
          links.reduce((total, link) => total + link.value, 0),
          graph.totalBytes,
          `${label}: stage ${stage}`,
        );
        assert.ok(
          links.every(link => graph.nodes[link.target].stage === stage + 1),
        );
      }
      console.log(
        `${label}: ${graph.paths.length} paths, ${graph.totalBytes} bytes; bitrate and stage totals match SQL`,
      );
      return graph;
    }

    await verify({ label: 'Canonical four dimensions' });
    await verify({
      label: 'Reordered dimensions',
      dimensions: [...canonical].reverse(),
      sqlDimensions: [...canonicalSql].reverse(),
    });
    await verify({
      label: 'Two dimensions',
      dimensions: [canonical[0], canonical[3]],
      sqlDimensions: [canonicalSql[0], canonicalSql[3]],
    });
    await verify({
      label: 'Five dimensions',
      dimensions: [
        ...canonical,
        {
          key: 'outputProvider',
          label: 'Output provider',
          expression: 'OutIfProvider',
        },
      ],
      sqlDimensions: [...canonicalSql, 'OutIfProvider'],
    });
    const limited = await verify({ label: 'Top two paths', limit: 2 });
    assert.equal(limited.paths.length, 2);

    const clicked = filtersToQuery({
      [sankeyDimensionExpression(canonical[2])]: {
        included: new Set(),
        excluded: new Set(['']),
      },
    });
    await verify({
      label: 'Lucene AND quick filters AND clicked provider exclusion',
      where: 'Bytes:[50000 TO 500000]',
      filters: { protocol: '6', exporter: 'core-iad-01' },
      extraFilters: filtersToQuery(parseQuery(clicked).filters),
      predicate:
        "Bytes BETWEEN 50000 AND 500000 AND Proto = 6 AND ExporterName = 'core-iad-01' AND InIfProvider != ''",
    });
    for (const nullable of [false, true]) {
      const provider = {
        ...canonical[2],
        expression: nullable ? "nullIf(InIfProvider, '')" : 'InIfProvider',
      };
      for (const excluded of [false, true]) {
        const clickFilters = filtersToQuery({
          [sankeyDimensionExpression(provider)]: {
            included: new Set(excluded ? [] : ['']),
            excluded: new Set(excluded ? [''] : []),
          },
        });
        const graph = await verify({
          label: `${nullable ? 'Null' : 'Empty'} provider ${excluded ? 'exclude' : 'include'} click`,
          dimensions: [canonical[0], canonical[1], provider, canonical[3]],
          extraFilters: filtersToQuery(parseQuery(clickFilters).filters),
          predicate: excluded ? "InIfProvider != ''" : "InIfProvider = ''",
        });
        assert.equal(
          graph.nodes.some(node => node.stage === 2 && node.rawValue === ''),
          !excluded,
        );
      }
    }
    const exporterExpression = "concat(ExporterSite, ':', ExporterName)";
    await verify({
      label: 'Custom dimension expression and pre-scaled byte mapping',
      mappedSource: {
        ...source,
        bytesExpression: 'Bytes * SamplingRate',
        samplingRateExpression: undefined,
        exporterExpression,
      },
      dimensions: [
        canonical[0],
        { ...canonical[3], expression: exporterExpression },
      ],
      sqlDimensions: [
        'toString(SrcAS)',
        "concat(ExporterSite, ':', ExporterName)",
      ],
    });
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
