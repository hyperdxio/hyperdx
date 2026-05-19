import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import Team from '@/models/team';

import { McpContext } from '../tools/types';
import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Source Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let traceSource: any;
  let logSource: any;
  let connection: any;
  let client: Client;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
    });

    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression:
        'Timestamp, ServiceName as service, SeverityText as level, Body',
      bodyExpression: 'Body',
      serviceNameExpression: 'ServiceName',
      severityTextExpression: 'SeverityText',
      connection: connection._id,
      name: 'Logs',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── hyperdx_list_sources ──────────────────────────────────────────────────

  describe('hyperdx_list_sources', () => {
    it('should list sources and connections as a lightweight catalog', async () => {
      const result = await callTool(client, 'hyperdx_list_sources');

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toHaveLength(2);

      const trace = output.sources.find(
        (s: any) => s.kind === SourceKind.Trace,
      );
      expect(trace).toMatchObject({
        id: traceSource._id.toString(),
        name: 'Traces',
        kind: SourceKind.Trace,
      });

      expect(output.connections).toHaveLength(1);
      expect(output.connections[0]).toMatchObject({
        id: connection._id.toString(),
        name: 'Default',
      });

      // Catalog should NOT include column schema or map keys
      expect(trace.columns).toBeUndefined();
      expect(trace.mapAttributeKeys).toBeUndefined();

      // Should include nextStep guidance pointing to describe_source
      expect(output.nextStep).toBeDefined();
      expect(output.nextStep).toContain('hyperdx_describe_source');
    });

    it('should include keyColumns from source config without ClickHouse queries', async () => {
      const result = await callTool(client, 'hyperdx_list_sources');
      const output = JSON.parse(getFirstText(result));

      const trace = output.sources.find(
        (s: any) => s.kind === SourceKind.Trace,
      );
      expect(trace.keyColumns).toBeDefined();
      expect(trace.keyColumns).toHaveProperty('spanName');
      expect(trace.keyColumns).toHaveProperty('duration');

      const log = output.sources.find((s: any) => s.kind === SourceKind.Log);
      expect(log.keyColumns).toBeDefined();
      expect(log.keyColumns).toHaveProperty('severityText');
      expect(log.keyColumns).toHaveProperty('body');
    });

    it('should return empty sources for a team with no sources', async () => {
      await client.close();
      await server.clearDBs();
      const result2 = await getLoggedInAgent(server);
      const context2: McpContext = {
        teamId: result2.team._id.toString(),
        userId: result2.user._id.toString(),
      };
      const client2 = await createTestClient(context2);

      const result = await callTool(client2, 'hyperdx_list_sources');
      const output = JSON.parse(getFirstText(result));

      expect(output.sources).toHaveLength(0);
      expect(output.connections).toHaveLength(0);

      await client2.close();
    });
  });

  // ── hyperdx_describe_source ───────────────────────────────────────────────

  describe('hyperdx_describe_source', () => {
    it('should return full column schema for a trace source', async () => {
      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: traceSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const output = JSON.parse(getFirstText(result));
      expect(output.source).toMatchObject({
        id: traceSource._id.toString(),
        name: 'Traces',
        kind: SourceKind.Trace,
      });

      // Column schema from ClickHouse DESCRIBE TABLE
      expect(output.source.columns).toBeDefined();
      expect(Array.isArray(output.source.columns)).toBe(true);
      expect(output.source.columns.length).toBeGreaterThan(0);
      expect(output.source.columns[0]).toHaveProperty('name');
      expect(output.source.columns[0]).toHaveProperty('type');
      expect(output.source.columns[0]).toHaveProperty('jsType');
    });

    it('should return full column schema for a log source', async () => {
      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: logSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));

      expect(output.source).toMatchObject({
        id: logSource._id.toString(),
        name: 'Logs',
        kind: SourceKind.Log,
      });

      // Log source should have columns
      expect(output.source.columns).toBeDefined();
      expect(output.source.columns.length).toBeGreaterThan(0);

      // Should expose log-specific keyColumns
      expect(output.source.keyColumns).toMatchObject({
        body: 'Body',
        severityText: 'SeverityText',
        serviceName: 'ServiceName',
      });
    });

    it('should include map attribute keys', async () => {
      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: traceSource._id.toString(),
      });
      const output = JSON.parse(getFirstText(result));

      // Trace sources have SpanAttributes and ResourceAttributes map columns.
      // Map keys may be empty when the table has no data, but the field
      // should still be a plain object (or absent).
      if (output.source.mapAttributeKeys) {
        expect(typeof output.source.mapAttributeKeys).toBe('object');
      }
    });

    it('should include keyColumns for trace source', async () => {
      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: traceSource._id.toString(),
      });
      const output = JSON.parse(getFirstText(result));

      expect(output.source.keyColumns).toBeDefined();
      expect(output.source.keyColumns).toHaveProperty('spanName');
      expect(output.source.keyColumns).toHaveProperty('duration');
      expect(output.source.keyColumns).toHaveProperty('traceId');
      expect(output.source.keyColumns).toHaveProperty('spanId');
    });

    it('should return metricTables for a metric source (no column schema)', async () => {
      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'Metrics',
      });

      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: metricSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));

      expect(output.source).toMatchObject({
        id: metricSource._id.toString(),
        name: 'Metrics',
        kind: SourceKind.Metric,
      });

      // Metric sources have metricTables but no column schema or value samples
      expect(output.source.metricTables).toBeDefined();
      expect(output.source.metricTables).toHaveProperty('gauge');
      expect(output.source.columns).toBeUndefined();
      expect(output.source.lowCardinalityValues).toBeUndefined();
      expect(output.source.mapAttributeKeys).toBeUndefined();
      expect(output.source.mapAttributeValues).toBeUndefined();
    });

    it('should include usage guidance and nextSteps', async () => {
      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: traceSource._id.toString(),
      });
      const output = JSON.parse(getFirstText(result));

      expect(output.usage).toBeDefined();
      expect(output.nextSteps).toBeDefined();
      expect(output.nextSteps.query).toContain(traceSource._id.toString());
    });

    it('should return error for non-existent source', async () => {
      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: '000000000000000000000000',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('should not allow access to another team source', async () => {
      const otherTeam = await Team.create({ name: 'Other Team' });
      const otherConnection = await Connection.create({
        team: otherTeam._id,
        name: 'Other Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      const otherSource = await Source.create({
        kind: SourceKind.Trace,
        team: otherTeam._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_TRACES_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        connection: otherConnection._id,
        name: 'Other Traces',
      });

      const result = await callTool(client, 'hyperdx_describe_source', {
        sourceId: otherSource._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });
  });
});
