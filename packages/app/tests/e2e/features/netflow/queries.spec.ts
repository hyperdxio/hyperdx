import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { filtersToQuery, parseQuery } from '@hyperdx/common-utils/dist/filters';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import {
  buildNetflowQueryConfigs,
  getNetflowDimensions,
} from '../../../../src/netflow';
import {
  buildNetflowSankeyConfig,
  buildNetflowSankeyData,
  sankeyDimensionExpression,
} from '../../../../src/netflowSankey';
import { expect, test } from '../../fixtures/netflow';

const queryRunner =
  (client: ClickhouseClient) =>
  async (config: BuilderChartConfigWithDateRange) =>
    (
      await client.queryChartConfig({
        config,
        metadata: getMetadata(client),
        querySettings: undefined,
      })
    ).data;

test('steady traffic keeps its rate in partial first and last buckets', async ({
  netflow,
}) => {
  const { client, database, source } = netflow;
  const run = queryRunner(client);
  const start = Date.parse('2026-10-09T12:00:00Z');
  const view = await client.query({
    query: `CREATE VIEW ${database}.steady AS
    SELECT toDateTime(${start / 1000}) + number AS TimeReceived,
      125 AS Bytes, 1 AS Packets, 100 AS SamplingRate FROM numbers(3660)`,
  });
  await view.text();
  const configs = buildNetflowQueryConfigs({
    source: {
      ...source,
      from: { databaseName: database, tableName: 'steady' },
    },
    dateRange: [new Date(start + 30000), new Date(start + 3620000)],
    filters: {},
  });
  const result = await run(configs.traffic);
  expect(result).toHaveLength(61);
  // 125 raw bytes/second * sampling 100 * 8. Both edge buckets have less than a minute of data.
  expect(result.map(row => Number(row['Bits per second']))).toEqual(
    Array(61).fill(100000),
  );
  const summary = await run(configs.summary);
  expect(Number(summary[0].__netflow_flowRecords)).toBe(3590);
  expect(Number(summary[0].__netflow_bytes)).toBe(3590 * 125 * 100);
});

test('NetFlow queries preserve sampled totals, raw records, aliases and Lucene semantics', async ({
  netflow,
}) => {
  const { client, source, dateRange, database } = netflow;
  const run = queryRunner(client);
  const direct = async (where = '1') =>
    (
      await (
        await client.query({
          query: `SELECT count() AS records, sum(Bytes * SamplingRate) AS bytes, sum(Packets * SamplingRate) AS packets FROM ${database}.flows WHERE ${where}`,
          format: 'JSONEachRow',
        })
      ).json<{ records: string; bytes: string; packets: string }>()
    )[0];
  const expected = await direct();
  const configs = buildNetflowQueryConfigs({ source, dateRange, filters: {} });
  for (const config of Object.values(configs).filter(
    config => config != null,
  )) {
    expect((await run(config)).length).toBeGreaterThan(0);
  }
  const [summary] = await run(configs.summary);
  expect(Number(summary.__netflow_flowRecords)).toBe(1200);
  expect(Number(summary.__netflow_bytes)).toBe(Number(expected.bytes));
  expect(Number(summary.__netflow_bitsPerSecond)).toBeCloseTo(
    (Number(expected.bytes) * 8) / 3600,
  );
  expect(Number(summary.__netflow_packetsPerSecond)).toBeCloseTo(
    Number(expected.packets) / 3600,
  );
  const records = await run(configs.flows);
  expect(records).toHaveLength(500);
  for (const row of records) {
    expect(Number(row.__netflow_bytes)).toBe(
      Number(row.__netflow_rawBytes) * Number(row.__netflow_samplingRate),
    );
    expect(Number(row.__netflow_packets)).toBe(
      Number(row.__netflow_rawPackets) * Number(row.__netflow_samplingRate),
    );
  }
  const scaled = buildNetflowQueryConfigs({
    source: {
      ...source,
      bytesExpression: 'Bytes * SamplingRate',
      samplingRateExpression: undefined,
    },
    dateRange,
    filters: {},
  });
  expect(Number((await run(scaled.totalBytes))[0].__netflow_value)).toBe(
    Number(expected.bytes),
  );
  for (const [where, sql] of [
    ['Proto:6', 'Proto = 6'],
    ['192.0.2.2', "SrcAddr = toIPv6('192.0.2.2')"],
    [
      '(Proto:6 OR Proto:17) AND NOT ExporterName:missing*',
      "Proto IN (6,17) AND ExporterName NOT ILIKE 'missing%'",
    ],
    ['Bytes:[500000 TO 2000000]', 'Bytes BETWEEN 500000 AND 2000000'],
    [
      'ExporterName:edge* AND DstPort:443',
      "ExporterName ILIKE 'edge%' AND DstPort = 443",
    ],
  ]) {
    const wanted = await direct(sql);
    const [actual] = await run(
      buildNetflowQueryConfigs({ source, dateRange, filters: {}, where })
        .summary,
    );
    expect(Number(actual.__netflow_flowRecords)).toBe(Number(wanted.records));
    expect(Number(actual.__netflow_bytes)).toBe(Number(wanted.bytes));
  }
  for (const [filters, count] of [
    [{ protocol: '6' }, 600],
    [{ srcAddr: '192.0.2.2' }, 300],
    [{ srcAddr: '2001:0db8:0001::2' }, 300],
    [{ exporter: "edge' OR 1=1 --" }, 0],
  ] as const) {
    const [actual] = await run(
      buildNetflowQueryConfigs({ source, dateRange, filters }).summary,
    );
    expect(Number(actual.__netflow_flowRecords)).toBe(count);
  }
  await expect(
    run(
      buildNetflowQueryConfigs({
        source,
        dateRange,
        filters: {},
        where: 'Proto:(',
      }).summary,
    ),
  ).rejects.toThrow();
});

test('NetFlow handles lowercase counter aliases and custom timestamp and exporter expressions', async ({
  netflow,
}) => {
  const { client, source, dateRange, database } = netflow;
  const run = queryRunner(client);
  const view = await client.query({
    query: `CREATE VIEW ${database}.lowercase AS SELECT
    TimeReceived AS timestamp, Bytes AS bytes, Packets AS packets,
    [NULL, -1, 0, 1, 100][toUnixTimestamp(TimeReceived) % 5 + 1] AS sampling, Proto AS protocol, ExporterName AS "router-name",
    SrcAddr AS srcAddr, DstAddr AS dstAddr, SrcPort AS srcPort, DstPort AS dstPort,
    InIfName AS inputInterface, OutIfName AS outputInterface FROM ${database}.flows`,
  });
  await view.text();
  const customSource = {
    ...source,
    from: { databaseName: database, tableName: 'lowercase' },
    timestampValueExpression: 'toDateTime(timestamp), toDate(timestamp)',
    bytesExpression: 'bytes',
    packetsExpression: 'packets',
    samplingRateExpression: 'sampling',
    protocolExpression: 'protocol',
    exporterExpression: '`router-name`',
    srcAddrExpression: 'srcAddr',
    dstAddrExpression: 'dstAddr',
    srcPortExpression: 'srcPort',
    dstPortExpression: 'dstPort',
    inIfExpression: 'inputInterface',
    outIfExpression: 'outputInterface',
  };
  const configs = buildNetflowQueryConfigs({
    source: customSource,
    dateRange,
    filters: { protocol: '6', exporter: 'edge-a' },
    where: 'dstPort = 443',
    whereLanguage: 'sql',
  });
  for (const config of Object.values(configs).filter(
    config => config != null,
  )) {
    expect((await run(config)).length).toBeGreaterThan(0);
  }
  const result = await run(configs.flows);
  const summary = await run(configs.summary);
  // Each of the five sampling values occurs 120 times after the TCP filter.
  expect(Number(summary[0].__netflow_bytes)).toBe(6246240000000);
  expect(Number(summary[0].__netflow_packetsPerSecond)).toBeCloseTo(
    12480000 / 3600,
  );
  for (const row of result) {
    expect([1, 100]).toContain(Number(row.__netflow_samplingRate));
    expect(Number(row.__netflow_bytes)).toBe(
      Number(row.__netflow_rawBytes) * Number(row.__netflow_samplingRate),
    );
  }
  const sankey = await run(
    buildNetflowSankeyConfig({
      baseConfig: configs.totalBytes,
      dimensions: [
        { key: 'src', label: 'Source', expression: 'srcAddr' },
        { key: 'dst', label: 'Destination', expression: 'dstAddr' },
      ],
    }),
  );
  expect(
    sankey.reduce((total, row) => total + Number(row.__netflow_value), 0),
  ).toBe(6246240000000);

  expect(result).toHaveLength(500);
  expect(new Date(String(result[0].__netflow_timestamp)).getTime()).toBe(
    dateRange[1].getTime() - 904000,
  );
  expect(
    result.every(
      row =>
        row.__netflow_protocol === 'TCP' && row.__netflow_exporter === 'edge-a',
    ),
  ).toBe(true);
});

test('NetFlow Sankey conserves path traffic and executes quoted, empty and composed filters', async ({
  netflow,
}) => {
  const { client, source, dateRange } = netflow;
  const run = queryRunner(client);
  const dimensions = [
    {
      key: 'src',
      label: 'Source',
      expression: getNetflowDimensions(source).srcAddr,
    },
    { key: 'provider', label: 'Provider', expression: '`provider-name`' },
    { key: 'exporter', label: 'Exporter', expression: 'ExporterName' },
  ];
  const configs = buildNetflowQueryConfigs({ source, dateRange, filters: {} });
  const config = buildNetflowSankeyConfig({
    baseConfig: configs.totalBytes,
    dimensions,
    limit: 100,
  });
  const data = buildNetflowSankeyData(await run(config), dimensions);
  expect(data.paths).toHaveLength(4);
  const total = Number((await run(configs.totalBytes))[0].__netflow_value);
  expect(data.paths.reduce((sum, path) => sum + path.value, 0)).toBe(total);
  for (const stage of [0, 1]) {
    expect(
      data.links
        .filter(link => data.nodes[link.source].stage === stage)
        .reduce((sum, link) => sum + link.value, 0),
    ).toBe(total);
  }
  const expression = sankeyDimensionExpression(dimensions[1]);
  for (const [value, count] of [
    ['', 300],
    ['provider', 900],
    ["' OR 1=1 --", 0],
  ] as const) {
    const extraFilters = filtersToQuery({
      [expression]: { included: new Set([value]), excluded: new Set() },
    });
    const restored = parseQuery(extraFilters);
    expect(Object.keys(restored.filters)).toHaveLength(1);
    const filtered = buildNetflowQueryConfigs({
      source,
      dateRange,
      filters: {},
      extraFilters,
    });
    const [summary] = await run(filtered.summary);
    expect(Number(summary.__netflow_flowRecords)).toBe(count);
  }
  const filtered = buildNetflowQueryConfigs({
    source,
    dateRange,
    filters: { protocol: '6' },
    where: 'DstPort:443',
    extraFilters: [{ type: 'sql', condition: "ExporterName IN ('edge-a')" }],
  });
  const paths = await run(
    buildNetflowSankeyConfig({
      baseConfig: filtered.totalBytes,
      dimensions,
      limit: 10,
    }),
  );
  expect(paths).toHaveLength(2);
});
