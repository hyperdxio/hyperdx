import assert from 'node:assert/strict';
import { createClient } from '@clickhouse/client';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TNetflowSource } from '@hyperdx/common-utils/dist/types';

import { buildNetflowQueryConfigs } from '../packages/app/src/netflow';

async function main() {
  const commands = createClient({
    url: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });
  const client = new ClickhouseClient({
    host: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    attribution: { surface: 'dashboard', label: 'netflow-verification' },
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
    const expected = await (
      await client.query({
        query:
          'SELECT toUnixTimestamp(min(TimeReceived)) AS start, toUnixTimestamp(max(TimeReceived)) + 1 AS end, count() AS records, sum(Bytes * SamplingRate) AS bytes FROM netflow_demo.flows',
        format: 'JSONEachRow',
      })
    ).json<{ start: number; end: number; records: string; bytes: string }>();
    assert.ok(
      Number(expected[0].records) > 0,
      'Seed the NetFlow demo before verifying',
    );
    const dateRange: [Date, Date] = [
      new Date(expected[0].start * 1000),
      new Date(expected[0].end * 1000),
    ];
    const metadata = getMetadata(client);
    const configs = buildNetflowQueryConfigs({
      source,
      dateRange,
      filters: {},
    });
    for (const [name, config] of Object.entries(configs)) {
      if (!config) continue;
      const result = await client.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      assert.ok(result.data.length > 0, `${name} returned no rows`);
      if (name === 'totalBytes')
        assert.equal(
          Number(result.data[0].__netflow_value),
          Number(expected[0].bytes),
        );
      if (name === 'flowRecords')
        assert.equal(
          Number(result.data[0].__netflow_value),
          Number(expected[0].records),
        );
      if (name === 'flows') assert.equal(result.data.length, 500);
      console.log(`${name}: ${result.data.length} rows OK`);
    }
    const preScaled = buildNetflowQueryConfigs({
      source: {
        ...source,
        bytesExpression: 'Bytes * SamplingRate',
        samplingRateExpression: undefined,
      },
      dateRange,
      filters: {},
    });
    const preScaledResult = await client.queryChartConfig({
      config: preScaled.totalBytes,
      metadata,
      querySettings: undefined,
    });
    assert.equal(
      Number(preScaledResult.data[0].__netflow_value),
      Number(expected[0].bytes),
    );
    console.log('Custom expressions with pre-scaled counters: OK');
    const viewName = `netflow_alias_regression_${process.pid}`;
    await commands.command({
      query: `CREATE VIEW netflow_demo.${viewName} AS SELECT
        TimeReceived AS timestamp, Bytes AS bytes, Packets AS packets,
        SamplingRate AS sampling, Proto AS protocol, ExporterName AS name,
        SrcAddr AS srcAddr, DstAddr AS dstAddr, SrcPort AS srcPort,
        DstPort AS dstPort, InIfName AS inputInterface,
        OutIfName AS outputInterface FROM netflow_demo.flows`,
    });
    try {
      const lowercase = buildNetflowQueryConfigs({
        source: {
          ...source,
          from: { ...source.from, tableName: viewName },
          timestampValueExpression: 'timestamp',
          bytesExpression: 'bytes',
          packetsExpression: 'packets',
          samplingRateExpression: 'sampling',
          protocolExpression: 'protocol',
          exporterExpression: 'name',
          srcAddrExpression: 'srcAddr',
          dstAddrExpression: 'dstAddr',
          srcPortExpression: 'srcPort',
          dstPortExpression: 'dstPort',
          inIfExpression: 'inputInterface',
          outIfExpression: 'outputInterface',
        },
        dateRange,
        filters: { protocol: '6' },
      });
      for (const [name, config] of Object.entries(lowercase)) {
        if (!config) continue;
        const result = await client.queryChartConfig({
          config,
          metadata,
          querySettings: undefined,
        });
        assert.ok(result.data.length > 0, `Lowercase ${name} returned no rows`);
        if (name === 'flows') {
          assert.equal(result.data.length, 500);
          for (const row of result.data) {
            assert.equal(row.__netflow_protocol, 'TCP');
            assert.equal(
              Number(row.__netflow_bytes),
              Number(row.__netflow_rawBytes) *
                Number(row.__netflow_samplingRate),
            );
            assert.equal(
              Number(row.__netflow_packets),
              Number(row.__netflow_rawPackets) *
                Number(row.__netflow_samplingRate),
            );
          }
        }
      }
      console.log(
        'Lowercase column aliases, raw counters, and protocol filters: OK',
      );
    } finally {
      await commands.command({ query: `DROP VIEW netflow_demo.${viewName}` });
    }
    for (const filters of [
      { protocol: '6' },
      { srcAddr: '192.0.2.2' },
      { srcAddr: '2001:0db8:0001::2' },
      { exporter: "edge' OR 1=1 --" },
    ]) {
      const config = buildNetflowQueryConfigs({
        source,
        dateRange,
        filters,
      }).flowRecords;
      const result = await client.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const count = Number(result.data[0].__netflow_value);
      assert.ok(
        count >= 0 && count < Number(expected[0].records),
        'Filter must restrict the result',
      );
      if ('exporter' in filters)
        assert.equal(count, 0, 'SQL syntax in a filter must remain a literal');
      else
        assert.ok(
          count > 0,
          'Matching protocol/address filters must return records',
        );
      console.log(`Filter ${JSON.stringify(filters)}: ${count} records OK`);
    }
    for (const test of [
      { where: 'Proto:6', sql: 'Proto = 6', filters: {} },
      {
        where: '(Proto:6 OR Proto:17) AND NOT ExporterName:core*',
        sql: "Proto IN (6, 17) AND ExporterName NOT ILIKE 'core%'",
        filters: {},
      },
      {
        where: 'Bytes:[50000 TO 500000]',
        sql: 'Bytes BETWEEN 50000 AND 500000',
        filters: {},
      },
      {
        where: 'ExporterName:edge* AND DstPort:443',
        sql: "ExporterName ILIKE 'edge%' AND DstPort = 443",
        filters: {},
      },
      {
        where: 'Bytes:[50000 TO *]',
        sql: "Bytes >= 50000 AND Proto = 6 AND ExporterName = 'edge-sfo-01'",
        filters: { protocol: '6', exporter: 'edge-sfo-01' },
      },
    ]) {
      const searched = buildNetflowQueryConfigs({
        source,
        dateRange,
        where: test.where,
        filters: test.filters,
      });
      const direct = await (
        await client.query({
          query: `SELECT count() AS records, sum(Bytes * SamplingRate) AS bytes
          FROM netflow_demo.flows WHERE ${test.sql}`,
          format: 'JSONEachRow',
        })
      ).json<{ records: string; bytes: string }>();
      assert.ok(
        Number(direct[0].records) > 0,
        'Lucene fixture must match records',
      );
      for (const [config, expectedValue] of [
        [searched.flowRecords, direct[0].records],
        [searched.totalBytes, direct[0].bytes],
      ] as const) {
        const result = await client.queryChartConfig({
          config,
          metadata,
          querySettings: undefined,
        });
        assert.equal(
          Number(result.data[0].__netflow_value),
          Number(expectedValue),
          test.where,
        );
      }
      console.log(`Lucene ${test.where}: count and sampled bytes match SQL`);
    }
    await assert.rejects(async () => {
      const malformed = buildNetflowQueryConfigs({
        source,
        dateRange,
        filters: {},
        where: 'Proto:(',
      });
      await client.queryChartConfig({
        config: malformed.flowRecords,
        metadata,
        querySettings: undefined,
      });
    });
    console.log('Malformed Lucene query rejected: OK');
  } finally {
    await client.close();
    await commands.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
