import assert from 'node:assert/strict';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  filtersToQuery,
  parseQuery,
} from '@hyperdx/common-utils/dist/filters';
import {
  SearchConditionLanguage,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

import {
  buildNetflowQueryConfigs,
  getNetflowDimensions,
} from '../packages/app/src/netflow';

async function main() {
  const client = new ClickhouseClient({
    host: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    attribution: { surface: 'dashboard', label: 'netflow-click-verification' },
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
  try {
    const bounds = await (
      await client.query({
        query:
          'SELECT toUnixTimestamp(min(TimeReceived)) AS start, toUnixTimestamp(max(TimeReceived)) + 1 AS end, count() AS records FROM netflow_demo.flows',
        format: 'JSONEachRow',
      })
    ).json<{ start: number; end: number; records: string }>();
    assert.ok(
      Number(bounds[0].records) > 0,
      'Seed NetFlow before verification',
    );
    const dateRange: [Date, Date] = [
      new Date(bounds[0].start * 1000),
      new Date(bounds[0].end * 1000),
    ];
    const metadata = getMetadata(client);
    const dimensions = getNetflowDimensions(source);

    async function verify({
      label,
      state,
      predicate,
      mappedSource = source,
      where = 'Bytes:[1000 TO *]',
      whereLanguage = 'lucene',
      expectedWhere = 'Bytes >= 1000',
      expectMatches = true,
    }: {
      label: string;
      state: FilterState;
      predicate: string;
      mappedSource?: TNetflowSource;
      where?: string;
      whereLanguage?: SearchConditionLanguage;
      expectedWhere?: string;
      expectMatches?: boolean;
    }) {
      const serialized = filtersToQuery(state);
      const restored = parseQuery(
        JSON.parse(JSON.stringify(serialized)),
      ).filters;
      assert.deepEqual(restored, state, `${label}: URL filter round trip`);
      const configs = buildNetflowQueryConfigs({
        source: mappedSource,
        dateRange,
        filters: {},
        where,
        whereLanguage,
        extraFilters: filtersToQuery(restored),
      });
      assert.equal(
        configs.flowRecords.where,
        where,
        'Search text must be retained',
      );
      const expected = await (
        await client.query({
          query: `SELECT count() AS records, sum(Bytes * SamplingRate) AS bytes
            FROM netflow_demo.flows WHERE (${expectedWhere}) AND (${predicate})`,
          format: 'JSONEachRow',
        })
      ).json<{ records: string; bytes: string }>();
      assert.equal(Number(expected[0].records) > 0, expectMatches, label);
      for (const [config, value] of [
        [configs.flowRecords, expected[0].records],
        [configs.totalBytes, expected[0].bytes],
      ] as const) {
        const result = await client.queryChartConfig({
          config,
          metadata,
          querySettings: undefined,
        });
        assert.equal(
          Number(result.data[0].__netflow_value),
          Number(value),
          label,
        );
      }
      console.log(
        `${label}: ${expected[0].records} records, sampled bytes match SQL`,
      );
    }

    for (const [field, value, predicate] of [
      ['srcAddr', '192.0.2.2', "SrcAddr = toIPv6('192.0.2.2')"],
      ['dstAddr', '203.0.113.2', "DstAddr = toIPv6('203.0.113.2')"],
      ['protocol', 'TCP', 'Proto = 6'],
      ['exporter', 'edge-fra-01', "ExporterName = 'edge-fra-01'"],
      ['inputInterface', 'ae1', "InIfName = 'ae1'"],
      ['outputInterface', 'ae1', "OutIfName = 'ae1'"],
      ['srcAddr', '2001:db8:1::2', "SrcAddr = toIPv6('2001:db8:1::2')"],
    ] as const) {
      const expression = dimensions[field];
      assert.ok(expression);
      for (const action of ['include', 'exclude'] as const) {
        await verify({
          label: `${field} ${action} ${value}`,
          state: {
            [expression]: {
              included: new Set(action === 'include' ? [value] : []),
              excluded: new Set(action === 'exclude' ? [value] : []),
            },
          },
          predicate: action === 'exclude' ? `NOT (${predicate})` : predicate,
        });
      }
    }
    await verify({
      label: 'Multiple includes OR together, exclusion ANDs with them',
      state: {
        [dimensions.protocol]: {
          included: new Set(['TCP', 'UDP']),
          excluded: new Set(['UDP']),
        },
      },
      predicate: 'Proto IN (6, 17) AND Proto != 17',
    });
    await verify({
      label: 'Click filter retains SQL search',
      state: {
        [dimensions.protocol]: {
          included: new Set(['TCP']),
          excluded: new Set(),
        },
      },
      predicate: 'Proto = 6',
      where: 'Bytes >= 1000 AND DstPort = 443',
      whereLanguage: 'sql',
      expectedWhere: 'Bytes >= 1000 AND DstPort = 443',
    });
    const escaped = "edge\\' OR 1=1 --";
    assert.ok(dimensions.exporter);
    for (const action of ['include', 'exclude'] as const) {
      await verify({
        label: `Quote/backslash ${action} remains a literal`,
        state: {
          [dimensions.exporter]: {
            included: new Set(action === 'include' ? [escaped] : []),
            excluded: new Set(action === 'exclude' ? [escaped] : []),
          },
        },
        predicate: action === 'include' ? '0' : '1',
        expectMatches: action === 'exclude',
      });
    }
    const mappedSource = {
      ...source,
      exporterExpression: "concat(ExporterSite, ':', ExporterName)",
    };
    const mappedDimensions = getNetflowDimensions(mappedSource);
    assert.ok(mappedDimensions.exporter);
    await verify({
      label: 'Custom exporter expression uses displayed value',
      mappedSource,
      state: {
        [mappedDimensions.exporter]: {
          included: new Set(['sfo:edge-sfo-01']),
          excluded: new Set(),
        },
      },
      predicate: "ExporterSite = 'sfo' AND ExporterName = 'edge-sfo-01'",
    });
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
