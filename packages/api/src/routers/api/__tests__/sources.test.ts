import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import {
  TLogSource,
  TMetricSource,
  TTraceSource,
} from '@/../../common-utils/dist/types';
import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import { LogSource, Source } from '@/models/source';
import Team from '@/models/team';
import { setupTeamDefaults } from '@/setupDefaults';

const MOCK_SOURCE: Omit<Extract<TSource, { kind: 'log' }>, 'id'> = {
  kind: SourceKind.Log,
  name: 'Test Source',
  connection: new Types.ObjectId().toString(),
  from: {
    databaseName: 'test_db',
    tableName: 'test_table',
  },
  timestampValueExpression: 'timestamp',
  defaultTableSelectExpression: 'body',
};

describe('sources router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET / - returns all sources for a team', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    await LogSource.create({
      ...MOCK_SOURCE,
      team: team._id,
    });

    const response = await agent.get('/sources').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      kind: MOCK_SOURCE.kind,
      name: MOCK_SOURCE.name,
      from: MOCK_SOURCE.from,
      timestampValueExpression: MOCK_SOURCE.timestampValueExpression,
    });
  });

  it('GET / - returns empty array when no sources exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent.get('/sources').expect(200);

    expect(response.body).toEqual([]);
  });

  it('POST / - creates a new source', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent.post('/sources').send(MOCK_SOURCE).expect(200);

    expect(response.body).toMatchObject({
      kind: MOCK_SOURCE.kind,
      name: MOCK_SOURCE.name,
      from: MOCK_SOURCE.from,
      timestampValueExpression: MOCK_SOURCE.timestampValueExpression,
    });

    // Verify source was created in database
    const sources = await Source.find({});
    expect(sources).toHaveLength(1);
  });

  it('POST / - returns 400 when request body is invalid', async () => {
    const { agent } = await getLoggedInAgent(server);

    // Missing required fields
    await agent
      .post('/sources')
      .send({
        kind: SourceKind.Log,
        name: 'Test Source',
      })
      .expect(400);
  });

  it('PUT /:id - updates an existing source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    const source = await LogSource.create({
      ...MOCK_SOURCE,
      team: team._id,
    });

    const updatedSource = {
      ...MOCK_SOURCE,
      id: source._id.toString(),
      name: 'Updated Name',
    };

    await agent.put(`/sources/${source._id}`).send(updatedSource).expect(200);

    // Verify source was updated
    const updatedSourceFromDB = await Source.findById(source._id);
    expect(updatedSourceFromDB?.name).toBe('Updated Name');
  });

  it('PUT /:id - returns 404 when source does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new Types.ObjectId().toString();

    await agent
      .put(`/sources/${nonExistentId}`)
      .send({
        ...MOCK_SOURCE,
        id: nonExistentId,
      })
      .expect(404);
  });

  it('DELETE /:id - deletes a source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    const source = await LogSource.create({
      ...MOCK_SOURCE,
      team: team._id,
    });

    await agent.delete(`/sources/${source._id}`).expect(200);

    // Verify source was deleted
    const deletedSource = await Source.findById(source._id);
    expect(deletedSource).toBeNull();
  });

  it('DELETE /:id - returns 200 when source does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new Types.ObjectId().toString();

    // This will succeed even if the ID doesn't exist, consistent with the implementation
    await agent.delete(`/sources/${nonExistentId}`).expect(200);
  });
});

describe('sources router - comprehensive source type tests', () => {
  const server = getServer();
  const connectionId = new Types.ObjectId().toString();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('Log Source - Full Field Verification', () => {
    it('POST / and GET / - creates and fetches log source with exact field matching', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const mockLogSource: Omit<TLogSource, 'id'> = {
        from: {
          databaseName: 'default',
          tableName: 'otel_logs',
        },
        kind: SourceKind.Log,
        timestampValueExpression: 'TimestampTime',
        connection: connectionId,
        name: 'Logs',
        displayedTimestampValueExpression: 'Timestamp',
        implicitColumnExpression: 'Body',
        serviceNameExpression: 'ServiceName',
        bodyExpression: 'Body',
        eventAttributesExpression: 'LogAttributes',
        resourceAttributesExpression: 'ResourceAttributes',
        defaultTableSelectExpression: 'Timestamp,ServiceName,SeverityText,Body',
        severityTextExpression: 'SeverityText',
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        metricSourceId: 'm',
        traceSourceId: 's',
      };

      // Create the source
      const createResponse = await agent
        .post('/sources')
        .send(mockLogSource)
        .expect(200);

      // Verify creation response
      expect(createResponse.body.kind).toBe(SourceKind.Log);
      expect(createResponse.body.team).toBe(team._id.toString());

      // Get all sources
      const getResponse = await agent.get('/sources').expect(200);
      expect(getResponse.body).toHaveLength(1);

      const fetchedSource = getResponse.body[0];

      // Verify all fields match exactly
      expect(fetchedSource.kind).toBe(SourceKind.Log);
      expect(fetchedSource.name).toBe('Logs');
      expect(fetchedSource.connection).toBe(connectionId);
      expect(fetchedSource.from).toEqual({
        databaseName: 'default',
        tableName: 'otel_logs',
      });
      expect(fetchedSource.timestampValueExpression).toBe('TimestampTime');
      expect(fetchedSource.displayedTimestampValueExpression).toBe('Timestamp');
      expect(fetchedSource.implicitColumnExpression).toBe('Body');
      expect(fetchedSource.serviceNameExpression).toBe('ServiceName');
      expect(fetchedSource.bodyExpression).toBe('Body');
      expect(fetchedSource.eventAttributesExpression).toBe('LogAttributes');
      expect(fetchedSource.resourceAttributesExpression).toBe(
        'ResourceAttributes',
      );
      expect(fetchedSource.defaultTableSelectExpression).toBe(
        'Timestamp,ServiceName,SeverityText,Body',
      );
      expect(fetchedSource.severityTextExpression).toBe('SeverityText');
      expect(fetchedSource.traceIdExpression).toBe('TraceId');
      expect(fetchedSource.spanIdExpression).toBe('SpanId');

      // Verify auto-generated cross-reference IDs exist
      expect(fetchedSource.metricSourceId).toBeTruthy();
      expect(fetchedSource.traceSourceId).toBeTruthy();
    });
  });

  describe('Trace Source - Full Field Verification', () => {
    it('POST / and GET / - creates and fetches trace source with exact field matching', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const mockTraceSource: Omit<TTraceSource, 'id'> = {
        kind: SourceKind.Trace,
        name: 'Traces',
        connection: connectionId,
        from: {
          databaseName: 'default',
          tableName: 'otel_traces',
        },
        timestampValueExpression: 'Timestamp',
        implicitColumnExpression: 'SpanName',
        serviceNameExpression: 'ServiceName',
        eventAttributesExpression: 'SpanAttributes',
        resourceAttributesExpression: 'ResourceAttributes',
        defaultTableSelectExpression:
          'Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName',
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        durationExpression: 'Duration',
        durationPrecision: 9,
        parentSpanIdExpression: 'ParentSpanId',
        spanNameExpression: 'SpanName',
        spanKindExpression: 'SpanKind',
        statusCodeExpression: 'StatusCode',
        statusMessageExpression: 'StatusMessage',
        logSourceId: 'l',
        sessionSourceId: 's',
        metricSourceId: 'm',
      };

      // Create the source
      const createResponse = await agent
        .post('/sources')
        .send(mockTraceSource)
        .expect(200);

      // Verify creation response
      expect(createResponse.body.kind).toBe(SourceKind.Trace);
      expect(createResponse.body.team).toBe(team._id.toString());

      // Get all sources
      const getResponse = await agent.get('/sources').expect(200);
      expect(getResponse.body).toHaveLength(1);

      const fetchedSource = getResponse.body[0];

      // Verify all fields match exactly
      expect(fetchedSource.kind).toBe(SourceKind.Trace);
      expect(fetchedSource.name).toBe('Traces');
      expect(fetchedSource.connection).toBe(connectionId);
      expect(fetchedSource.from).toEqual({
        databaseName: 'default',
        tableName: 'otel_traces',
      });
      expect(fetchedSource.timestampValueExpression).toBe('Timestamp');
      expect(fetchedSource.implicitColumnExpression).toBe('SpanName');
      expect(fetchedSource.serviceNameExpression).toBe('ServiceName');
      expect(fetchedSource.eventAttributesExpression).toBe('SpanAttributes');
      expect(fetchedSource.resourceAttributesExpression).toBe(
        'ResourceAttributes',
      );
      expect(fetchedSource.defaultTableSelectExpression).toBe(
        'Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName',
      );
      expect(fetchedSource.traceIdExpression).toBe('TraceId');
      expect(fetchedSource.spanIdExpression).toBe('SpanId');
      expect(fetchedSource.durationExpression).toBe('Duration');
      expect(fetchedSource.durationPrecision).toBe(9);
      expect(fetchedSource.parentSpanIdExpression).toBe('ParentSpanId');
      expect(fetchedSource.spanNameExpression).toBe('SpanName');
      expect(fetchedSource.spanKindExpression).toBe('SpanKind');
      expect(fetchedSource.statusCodeExpression).toBe('StatusCode');
      expect(fetchedSource.statusMessageExpression).toBe('StatusMessage');

      // Verify auto-generated cross-reference IDs exist
      expect(fetchedSource.logSourceId).toBeTruthy();
      expect(fetchedSource.metricSourceId).toBeTruthy();
      expect(fetchedSource.sessionSourceId).toBeTruthy();
    });
  });

  describe('Metric Source - Full Field Verification', () => {
    it('POST / and GET / - creates and fetches metric source with exact field matching', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const mockMetricSource: Omit<TMetricSource, 'id'> = {
        kind: SourceKind.Metric,
        name: 'Metrics',
        connection: connectionId,
        from: {
          databaseName: 'default',
          tableName: '',
        },
        timestampValueExpression: 'TimeUnix',
        resourceAttributesExpression: 'ResourceAttributes',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        logSourceId: 'l',
      };

      // Create the source
      const createResponse = await agent
        .post('/sources')
        .send(mockMetricSource)
        .expect(200);

      // Verify creation response
      expect(createResponse.body.kind).toBe(SourceKind.Metric);
      expect(createResponse.body.team).toBe(team._id.toString());

      // Get all sources
      const getResponse = await agent.get('/sources').expect(200);
      expect(getResponse.body).toHaveLength(1);

      const fetchedSource = getResponse.body[0];

      // Verify all fields match exactly
      expect(fetchedSource.kind).toBe(SourceKind.Metric);
      expect(fetchedSource.name).toBe('Metrics');
      expect(fetchedSource.connection).toBe(connectionId);
      expect(fetchedSource.from).toEqual({
        databaseName: 'default',
        tableName: '',
      });
      expect(fetchedSource.timestampValueExpression).toBe('TimeUnix');
      expect(fetchedSource.resourceAttributesExpression).toBe(
        'ResourceAttributes',
      );
      expect(fetchedSource.metricTables).toMatchObject({
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
        id: fetchedSource.metricTables.id,
      });

      // Verify auto-generated cross-reference IDs exist
      expect(fetchedSource.logSourceId).toBeTruthy();
    });
  });

  describe('Session Source - Full Field Verification', () => {
    it('POST / and GET / - creates and fetches session source with exact field matching', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      // Based on the provided API response, session sources seem to have log-like fields
      const mockSessionSource = {
        kind: SourceKind.Session,
        name: 'Sessions',
        connection: connectionId,
        from: {
          databaseName: 'default',
          tableName: 'hyperdx_sessions',
        },
        traceSourceId: 't',
        timestampValueExpression: 'TimestampTime',
      };

      // Create the source
      const createResponse = await agent
        .post('/sources')
        .send(mockSessionSource)
        .expect(200);

      // Verify creation response
      expect(createResponse.body.kind).toBe(SourceKind.Session);
      expect(createResponse.body.team).toBe(team._id.toString());

      // Get all sources
      const getResponse = await agent.get('/sources').expect(200);
      expect(getResponse.body).toHaveLength(1);

      // Find the session source
      const fetchedSource = getResponse.body.find(
        (s: any) => s.kind === SourceKind.Session,
      );

      // Verify all fields match exactly
      expect(fetchedSource.kind).toBe(SourceKind.Session);
      expect(fetchedSource.name).toBe('Sessions');
      expect(fetchedSource.connection).toBe(connectionId);
      expect(fetchedSource.from).toEqual({
        databaseName: 'default',
        tableName: 'hyperdx_sessions',
      });
      expect(fetchedSource.traceSourceId).toBeTruthy();

      // Session sources inherit log-like fields
      expect(fetchedSource.timestampValueExpression).toBe('TimestampTime');

      // Verify auto-generated cross-reference IDs exist
      expect(fetchedSource.traceSourceId).toBeTruthy();
    });
  });

  describe('Multiple Source Creation and Retrieval', () => {
    it('creates all source types and retrieves them with exact field matching', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      // Create log source
      await agent
        .post('/sources')
        .send({
          kind: SourceKind.Log,
          name: 'Logs',
          connection: connectionId,
          from: {
            databaseName: 'default',
            tableName: 'otel_logs',
          },
          timestampValueExpression: 'TimestampTime',
          defaultTableSelectExpression:
            'Timestamp,ServiceName,SeverityText,Body',
        })
        .expect(200);

      // Create trace source
      const traceResponse = await agent
        .post('/sources')
        .send({
          kind: SourceKind.Trace,
          name: 'Traces',
          connection: connectionId,
          from: {
            databaseName: 'default',
            tableName: 'otel_traces',
          },
          timestampValueExpression: 'Timestamp',
          traceIdExpression: 'TraceId',
          spanIdExpression: 'SpanId',
          durationExpression: 'Duration',
          durationPrecision: 9,
          parentSpanIdExpression: 'ParentSpanId',
          spanNameExpression: 'SpanName',
          spanKindExpression: 'SpanKind',
        })
        .expect(200);

      // Create metric source
      await agent
        .post('/sources')
        .send({
          kind: SourceKind.Metric,
          name: 'Metrics',
          connection: connectionId,
          from: {
            databaseName: 'default',
            tableName: '',
          },
          timestampValueExpression: 'TimeUnix',
          resourceAttributesExpression: 'ResourceAttributes',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
          },
        })
        .expect(200);

      // Create session source
      await agent
        .post('/sources')
        .send({
          kind: SourceKind.Session,
          name: 'Sessions',
          connection: connectionId,
          from: {
            databaseName: 'default',
            tableName: 'hyperdx_sessions',
          },
          traceSourceId: traceResponse.body._id,
        })
        .expect(200);

      // Get all sources
      const getResponse = await agent.get('/sources').expect(200);
      expect(getResponse.body).toHaveLength(4);

      // Verify we have one of each type
      const kinds = getResponse.body.map((s: any) => s.kind);
      expect(kinds).toContain(SourceKind.Log);
      expect(kinds).toContain(SourceKind.Trace);
      expect(kinds).toContain(SourceKind.Metric);
      expect(kinds).toContain(SourceKind.Session);

      // Verify each source has the expected structure
      getResponse.body.forEach((source: any) => {
        expect(source._id).toBeTruthy();
        expect(source.kind).toBeTruthy();
        expect(source.team).toBe(team._id.toString());
        expect(source.name).toBeTruthy();
        expect(source.connection).toBe(connectionId);
        expect(source.from).toBeTruthy();
        expect(source.id).toBeTruthy();
      });
    });
  });
});

// Mock the config module before importing setupTeamDefaults
jest.mock('@/config', () => {
  const actualConfig = jest.requireActual('@/config');
  return {
    ...actualConfig,
    get DEFAULT_CONNECTIONS() {
      return process.env.DEFAULT_CONNECTIONS;
    },
    get DEFAULT_SOURCES() {
      return process.env.DEFAULT_SOURCES;
    },
  };
});

describe('setupTeamDefaults', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
    // Clear the environment variables after each test
    delete process.env.DEFAULT_CONNECTIONS;
    delete process.env.DEFAULT_SOURCES;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should create default sources with exact field matching', async () => {
    // Define the default configurations
    const defaultConnections = [
      {
        name: 'Local ClickHouse',
        host: 'http://localhost:8123',
        username: 'default',
        password: '',
      },
    ];

    const defaultSources = [
      {
        from: {
          databaseName: 'default',
          tableName: 'otel_logs',
        },
        kind: 'log',
        timestampValueExpression: 'TimestampTime',
        name: 'Logs',
        displayedTimestampValueExpression: 'Timestamp',
        implicitColumnExpression: 'Body',
        serviceNameExpression: 'ServiceName',
        bodyExpression: 'Body',
        eventAttributesExpression: 'LogAttributes',
        resourceAttributesExpression: 'ResourceAttributes',
        defaultTableSelectExpression: 'Timestamp,ServiceName,SeverityText,Body',
        severityTextExpression: 'SeverityText',
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        connection: 'Local ClickHouse',
        traceSourceId: 'Traces',
        sessionSourceId: 'Sessions',
        metricSourceId: 'Metrics',
      },
      {
        from: {
          databaseName: 'default',
          tableName: 'otel_traces',
        },
        kind: 'trace',
        timestampValueExpression: 'Timestamp',
        name: 'Traces',
        displayedTimestampValueExpression: 'Timestamp',
        implicitColumnExpression: 'SpanName',
        serviceNameExpression: 'ServiceName',
        bodyExpression: 'SpanName',
        eventAttributesExpression: 'SpanAttributes',
        resourceAttributesExpression: 'ResourceAttributes',
        defaultTableSelectExpression:
          'Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName',
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        durationExpression: 'Duration',
        durationPrecision: 9,
        parentSpanIdExpression: 'ParentSpanId',
        spanNameExpression: 'SpanName',
        spanKindExpression: 'SpanKind',
        statusCodeExpression: 'StatusCode',
        statusMessageExpression: 'StatusMessage',
        connection: 'Local ClickHouse',
        logSourceId: 'Logs',
        sessionSourceId: 'Sessions',
        metricSourceId: 'Metrics',
      },
      {
        from: {
          databaseName: 'default',
          tableName: '',
        },
        kind: 'metric',
        timestampValueExpression: 'TimeUnix',
        name: 'Metrics',
        resourceAttributesExpression: 'ResourceAttributes',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
        },
        connection: 'Local ClickHouse',
        logSourceId: 'Logs',
        traceSourceId: 'Traces',
        sessionSourceId: 'Sessions',
      },
      {
        name: 'Sessions',
        kind: 'session',
        from: {
          databaseName: 'default',
          tableName: 'hyperdx_sessions',
        },
        connection: 'Local ClickHouse',
        timestampValueExpression: 'TimestampTime',
        traceSourceId: 'Traces',
      },
    ];

    // Set environment variables for this specific test
    process.env.DEFAULT_CONNECTIONS = JSON.stringify(defaultConnections);
    process.env.DEFAULT_SOURCES = JSON.stringify(defaultSources);

    // Create a team
    const team = await Team.create({
      name: 'Test Team',
    });

    // Call setupTeamDefaults directly - it will read from env vars through our mock
    await setupTeamDefaults(team._id.toString());

    // Verify connections were created
    const connections = await Connection.find({ team: team._id });
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe('Local ClickHouse');

    // Verify sources were created
    const sources = await Source.find({ team: team._id });
    expect(sources).toHaveLength(4);

    // Get each source type
    const logSource = sources.find(s => s.kind === 'log');
    const traceSource = sources.find(s => s.kind === 'trace');
    const metricSource = sources.find(s => s.kind === 'metric');
    const sessionSource = sources.find(s => s.kind === 'session');

    // Verify all source types were found
    expect(logSource).toBeTruthy();
    if (!logSource || logSource.kind !== SourceKind.Log) return;
    expect(traceSource).toBeTruthy();
    if (!traceSource || traceSource.kind !== SourceKind.Trace) return;
    expect(metricSource).toBeTruthy();
    if (!metricSource || metricSource.kind !== SourceKind.Metric) return;
    expect(sessionSource).toBeTruthy();
    if (!sessionSource || sessionSource.kind !== SourceKind.Session) return;

    // Verify LOG source has all expected fields
    expect(logSource).toMatchObject({
      kind: 'log',
      name: 'Logs',
      from: {
        databaseName: 'default',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'TimestampTime',
      displayedTimestampValueExpression: 'Timestamp',
      implicitColumnExpression: 'Body',
      serviceNameExpression: 'ServiceName',
      bodyExpression: 'Body',
      eventAttributesExpression: 'LogAttributes',
      resourceAttributesExpression: 'ResourceAttributes',
      defaultTableSelectExpression: 'Timestamp,ServiceName,SeverityText,Body',
      severityTextExpression: 'SeverityText',
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
    });
    // Verify cross-references
    expect(logSource.traceSourceId?.toString()).toBe(
      traceSource!._id.toString(),
    );
    expect(logSource.metricSourceId?.toString()).toBe(
      metricSource!._id.toString(),
    );

    // Verify TRACE source has all expected fields
    expect(traceSource).toMatchObject({
      kind: 'trace',
      name: 'Traces',
      from: {
        databaseName: 'default',
        tableName: 'otel_traces',
      },
      timestampValueExpression: 'Timestamp',
      implicitColumnExpression: 'SpanName',
      serviceNameExpression: 'ServiceName',
      eventAttributesExpression: 'SpanAttributes',
      resourceAttributesExpression: 'ResourceAttributes',
      defaultTableSelectExpression:
        'Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName',
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      durationExpression: 'Duration',
      durationPrecision: 9,
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      statusCodeExpression: 'StatusCode',
      statusMessageExpression: 'StatusMessage',
    });
    // Verify cross-references
    expect(traceSource.logSourceId?.toString()).toBe(logSource!._id.toString());
    expect(traceSource.sessionSourceId?.toString()).toBe(
      sessionSource!._id.toString(),
    );
    expect(traceSource.metricSourceId?.toString()).toBe(
      metricSource!._id.toString(),
    );

    // Verify METRIC source has all expected fields
    expect(metricSource).toMatchObject({
      kind: 'metric',
      name: 'Metrics',
      from: {
        databaseName: 'default',
        tableName: '',
      },
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
      },
    });
    // Verify cross-references
    expect(metricSource.logSourceId?.toString()).toBe(
      logSource!._id.toString(),
    );

    // Verify SESSION source has all expected fields
    expect(sessionSource).toMatchObject({
      kind: 'session',
      name: 'Sessions',
      from: {
        databaseName: 'default',
        tableName: 'hyperdx_sessions',
      },
      timestampValueExpression: 'TimestampTime',
    });
    // Verify cross-references
    expect(sessionSource.traceSourceId.toString()).toBe(
      traceSource!._id.toString(),
    );
  });
});
