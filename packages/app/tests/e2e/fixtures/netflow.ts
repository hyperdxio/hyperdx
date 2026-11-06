import { randomUUID } from 'crypto';
import {
  ClickhouseClient,
  createNativeClient,
} from '@hyperdx/common-utils/dist/clickhouse/node';
import { SourceKind, TNetflowSource } from '@hyperdx/common-utils/dist/types';

import { getApiUrl } from '../utils/api-helpers';
import { expect, test as base } from '../utils/base-test';

const host =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;
const credentials = {
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
};

export const test = base.extend<{
  netflow: {
    database: string;
    source: TNetflowSource;
    alternative: TNetflowSource;
    dateRange: [Date, Date];
    client: ClickhouseClient;
  };
}>({
  netflow: async ({ request }, provide) => {
    const database = `netflow_e2e_${randomUUID().replaceAll('-', '')}`;
    const commands = createNativeClient({ url: host, ...credentials });
    const client = new ClickhouseClient({ host, ...credentials });
    const end = new Date(Math.floor(Date.now() / 60000) * 60000);
    const start = new Date(end.getTime() - 60 * 60000);
    let source: TNetflowSource = {
      id: `${database}_flows`,
      name: `${database} flows`,
      kind: SourceKind.Netflow,
      connection: 'netflow-test',
      from: { databaseName: database, tableName: 'flows' },
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
    let alternative = {
      ...source,
      id: `${database}_other`,
      name: `${database} other`,
    };
    const createdSources: string[] = [];
    try {
      await commands.command({ query: `CREATE DATABASE ${database}` });
      await commands.command({
        query: `CREATE TABLE ${database}.flows (
        TimeReceived DateTime('UTC'), Bytes UInt64, Packets UInt64, SamplingRate UInt64,
        SrcAddr IPv6, DstAddr IPv6, SrcPort UInt16, DstPort UInt16, Proto UInt8,
        ExporterName String, InIfName String, OutIfName String,
        SrcAS UInt32, InIfConnectivity String, InIfProvider String,
        "provider-name" Nullable(String)
      ) ENGINE = MergeTree ORDER BY TimeReceived`,
      });
      // Four paths repeat across an hour, including sampled IPv4, IPv6 and an empty classification.
      await commands.command({
        query: `INSERT INTO ${database}.flows SELECT
          toDateTime(${end.getTime() / 1000}) - 3300 + number * 2,
        if(number % 4 = 0, 1000000, 1000000000), 1000, if(number % 2 = 0, 100, 1),
        toIPv6(['192.0.2.2','192.0.2.3','2001:db8:1::2','2001:db8:1::3'][number % 4 + 1]),
        toIPv6('198.51.100.1'), 12345, if(number % 2 = 0, 443, 53),
        if(number % 2 = 0, 6, 17), if(number % 2 = 0, 'edge-a', 'edge-b'),
        'eth0', 'eth1', 64500 + number % 4, 'transit',
        ['peer-east','peer-west','',''][number % 4 + 1],
        if(number % 4 = 2, NULL, 'provider')
        FROM numbers(1200)`,
      });
      if (process.env.E2E_FULLSTACK === 'true') {
        const connections = await request.get(`${getApiUrl()}/connections`);
        expect(connections.ok()).toBeTruthy();
        const [connection] = await connections.json();
        const create = async (
          input: TNetflowSource,
        ): Promise<TNetflowSource> => {
          const response = await request.post(`${getApiUrl()}/sources`, {
            data: { ...input, connection: connection.id },
          });
          expect(response.ok(), await response.text()).toBeTruthy();
          const saved = await response.json();
          const id = saved.id || saved._id;
          createdSources.push(id);
          return { ...input, id, connection: connection.id };
        };
        source = await create(source);
        alternative = await create(alternative);
      }
      await provide({
        database,
        source,
        alternative,
        dateRange: [start, end],
        client,
      });
    } finally {
      if (process.env.E2E_FULLSTACK === 'true') {
        const response = await request.get(`${getApiUrl()}/sources`);
        const sources: TNetflowSource[] = await response.json();
        for (const saved of sources.filter(
          item => item.from.databaseName === database,
        )) {
          if (!createdSources.includes(saved.id)) createdSources.push(saved.id);
        }
      }
      for (const id of createdSources)
        await request.delete(`${getApiUrl()}/sources/${id}`);
      await commands.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
      await commands.close();
    }
  },
  localSources: async ({ netflow }, provide) =>
    provide([netflow.source, netflow.alternative]),
  localConnections: async ({}, provide) =>
    provide([
      { id: 'netflow-test', name: 'NetFlow test', host, ...credentials },
    ]),
});

export { expect };
