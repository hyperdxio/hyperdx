import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  getLoggedInAgent,
  getServer,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

const mockFetch = jest.mocked(global.fetch);

const TABLE = 'mcp_promql_sources';

const prometheusResponse = (data: unknown) =>
  new Response(JSON.stringify({ status: 'success', data }));

describe('MCP PromQL sources', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let promqlSource: any;
  let client: Client;

  const connect = async (promqlEnabled: boolean) => {
    client = await createTestClient({
      teamId: team._id.toString(),
      userId: user._id.toString(),
      promqlEnabled,
    });
  };

  const createPrometheusSource = async () => {
    const connection = await Connection.create({
      team: team._id,
      name: 'Prometheus',
      host: 'http://user:secret@prom.example.com',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });
    return Source.create({
      kind: SourceKind.Promql,
      team: team._id,
      connection: connection._id,
      name: 'Prometheus metrics',
      from: { databaseName: 'prometheus', tableName: 'prometheus' },
      timestampValueExpression: 'timestamp',
    });
  };

  beforeAll(async () => {
    await server.start();
    const nowSec = Math.floor(Date.now() / 1000);
    await seedTimeSeriesTagsTable({
      table: TABLE,
      series: [
        {
          metricName: 'http_requests_total',
          tags: { job: 'checkout', instance: 'checkout-0' },
          startSec: nowSec - 600,
          endSec: nowSec - 60,
        },
        {
          metricName: 'up',
          tags: { job: 'cart' },
          startSec: nowSec - 600,
          endSec: nowSec - 60,
        },
      ],
      withSamples: true,
    });
  });

  beforeEach(async () => {
    ({ team, user } = await getLoggedInAgent(server));
    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    promqlSource = await Source.create({
      kind: SourceKind.Promql,
      team: team._id,
      connection: connection._id,
      name: 'TimeSeries metrics',
      from: { databaseName: DEFAULT_DATABASE, tableName: TABLE },
      timestampValueExpression: 'timestamp',
    });
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await dropTimeSeriesTable({ table: TABLE });
    await server.stop();
  });

  describe('with PromQL enabled', () => {
    beforeEach(() => connect(true));

    it('lists a TimeSeries source with its table, with usage guidance', async () => {
      const result = await callTool(client, 'clickstack_list_sources');

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toHaveLength(1);
      expect(output.sources[0]).toMatchObject({
        id: promqlSource._id.toString(),
        kind: SourceKind.Promql,
        backend: 'clickhouse',
        table: `${DEFAULT_DATABASE}.${TABLE}`,
      });
      expect(output.promqlUsage).toContain('timeSeriesData');
    });

    it('lists a Prometheus endpoint source without its placeholder table', async () => {
      const source = await createPrometheusSource();

      const result = await callTool(client, 'clickstack_list_sources');

      const output = JSON.parse(getFirstText(result));
      const listed = output.sources.find(
        (s: any) => s.id === source._id.toString(),
      );
      expect(listed.backend).toBe('prometheus');
      expect(listed.table).toBeUndefined();
      expect(listed.database).toBeUndefined();
    });

    it('reads a TimeSeries table through clickstack_sql as the hint describes', async () => {
      const table = `${DEFAULT_DATABASE}.${TABLE}`;
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: promqlSource.connection.toString(),
        sql:
          `SELECT t.metric_name AS metric, count() AS samples ` +
          `FROM timeSeriesData(${table}) AS d ` +
          `INNER JOIN timeSeriesTags(${table}) AS t ON d.id = t.id ` +
          `GROUP BY metric ORDER BY metric`,
      });

      expect(result.isError).toBeFalsy();
      const text = getFirstText(result);
      expect(text).toContain('http_requests_total');
      expect(text).toContain('up');
    });

    it('describes a TimeSeries table by its label names and metric names', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: promqlSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.source).toMatchObject({
        id: promqlSource._id.toString(),
        kind: SourceKind.Promql,
        backend: 'clickhouse',
        table: `${DEFAULT_DATABASE}.${TABLE}`,
      });
      expect(output.labelNames).toEqual(['__name__', 'instance', 'job']);
      expect(output.metricNames).toEqual(['http_requests_total', 'up']);
      expect(output.columns).toBeUndefined();
      expect(output.nextSteps.sql).toContain(
        `timeSeriesData(${DEFAULT_DATABASE}.${TABLE})`,
      );
    });

    it('describes a Prometheus endpoint source through its label API', async () => {
      const source = await createPrometheusSource();
      mockFetch.mockImplementation(async input =>
        prometheusResponse(
          String(input).includes('/label/__name__/values')
            ? ['up']
            : ['__name__', 'job'],
        ),
      );

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: source._id.toString(),
      });

      const output = JSON.parse(getFirstText(result));
      expect(output.source.backend).toBe('prometheus');
      expect(output.source.table).toBeUndefined();
      expect(output.nextSteps.sql).toBeUndefined();
      expect(output.labelNames).toEqual(['__name__', 'job']);
      expect(output.metricNames).toEqual(['up']);
      const urls = mockFetch.mock.calls.map(
        ([input]) => new URL(String(input)),
      );
      expect(urls.map(u => u.pathname).sort()).toEqual([
        '/api/v1/label/__name__/values',
        '/api/v1/labels',
      ]);
      expect(urls[0].searchParams.get('start')).toBeTruthy();
    });

    it('still returns the source config when the label lookup fails', async () => {
      const source = await createPrometheusSource();
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: source._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.source.config).toMatchObject({ kind: SourceKind.Promql });
      expect(output.partial).toBe(true);
      expect(output.error).toContain('http://prom.example.com/api/v1/');
      expect(output.error).not.toContain('secret');
    });
  });

  describe('with PromQL disabled', () => {
    beforeEach(() => connect(false));

    it('hides PromQL sources from clickstack_list_sources', async () => {
      const result = await callTool(client, 'clickstack_list_sources');

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toEqual([]);
      expect(output.promqlUsage).toBeUndefined();
    });

    it('treats a PromQL source as not found in clickstack_describe_source', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: promqlSource._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('treats a PromQL source as not found in clickstack_delete_source', async () => {
      const result = await callTool(client, 'clickstack_delete_source', {
        id: promqlSource._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(await Source.findById(promqlSource._id)).not.toBeNull();
    });

    it('rejects kind promql in clickstack_save_source', async () => {
      const result = await callTool(client, 'clickstack_save_source', {
        kind: 'promql',
        name: 'New PromQL',
        connection: promqlSource.connection.toString(),
        databaseName: DEFAULT_DATABASE,
        tableName: TABLE,
        timestampValueExpression: 'timestamp',
      });

      expect(result.isError).toBe(true);
      expect(await Source.countDocuments({ name: 'New PromQL' })).toBe(0);
    });
  });
});
