import { SourceKind, TSourceUnion } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import { Source } from '@/models/source';

const MOCK_SOURCE: Omit<Extract<TSourceUnion, { kind: 'log' }>, 'id'> = {
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
    await Source.create({
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
    const source = await Source.create({
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

  it('PUT /:id - cleans up type-specific properties when changing source kind', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create a metric source with metricTables property
    const metricSource = await Source.create({
      kind: SourceKind.Metric,
      name: 'Test Metric Source',
      connection: new Types.ObjectId().toString(),
      from: {
        databaseName: 'test_db',
        tableName: 'otel_metrics',
      },
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        sum: 'otel_metrics_sum',
      },
      team: team._id,
    });

    // Verify the metric source has metricTables
    const createdSource = await Source.findById(metricSource._id).lean();
    expect(createdSource?.metricTables).toBeDefined();

    // Update the source to a trace source
    const traceSource = {
      id: metricSource._id.toString(),
      kind: SourceKind.Trace,
      name: 'Test Trace Source',
      connection: metricSource.connection,
      from: {
        databaseName: 'test_db',
        tableName: 'otel_traces',
      },
      timestampValueExpression: 'Timestamp',
      durationExpression: 'Duration',
      durationPrecision: 9,
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      defaultTableSelectExpression: 'Timestamp, ServiceName',
    };

    await agent
      .put(`/sources/${metricSource._id}`)
      .send(traceSource)
      .expect(200);

    // Verify the trace source does NOT have metricTables property
    const updatedSource = await Source.findById(metricSource._id).lean();
    expect(updatedSource?.kind).toBe(SourceKind.Trace);
    expect(updatedSource?.metricTables).toBeNull();
    expect(updatedSource?.durationExpression).toBe('Duration');
  });

  it('PUT /:id - preserves metricTables when source remains Metric, removes when changed to another type', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create a metric source with metricTables property
    const metricSource = await Source.create({
      kind: SourceKind.Metric,
      name: 'Test Metric Source',
      connection: new Types.ObjectId().toString(),
      from: {
        databaseName: 'test_db',
        tableName: 'otel_metrics',
      },
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        sum: 'otel_metrics_sum',
      },
      team: team._id,
    });

    // Step 1: Update the metric source (but keep it as Metric)
    const updatedMetricSource = {
      id: metricSource._id.toString(),
      kind: SourceKind.Metric,
      name: 'Updated Metric Source',
      connection: metricSource.connection,
      from: metricSource.from,
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge_v2',
        sum: 'otel_metrics_sum_v2',
      },
    };

    await agent
      .put(`/sources/${metricSource._id}`)
      .send(updatedMetricSource)
      .expect(200);

    let updatedSource = await Source.findById(metricSource._id).lean();

    // Verify the metric source still has metricTables with updated values
    expect(updatedSource?.kind).toBe(SourceKind.Metric);
    expect(updatedSource?.metricTables).toMatchObject({
      gauge: 'otel_metrics_gauge_v2',
      sum: 'otel_metrics_sum_v2',
    });

    // Step 2: Change the source to a Log type
    const logSource = {
      id: metricSource._id.toString(),
      kind: SourceKind.Log,
      name: 'Test Log Source',
      connection: metricSource.connection,
      from: {
        databaseName: 'test_db',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: 'Body',
      severityTextExpression: 'SeverityText',
    };

    await agent.put(`/sources/${metricSource._id}`).send(logSource).expect(200);

    updatedSource = await Source.findById(metricSource._id).lean();

    // Verify the source is now a Log and metricTables is removed
    expect(updatedSource?.kind).toBe(SourceKind.Log);
    expect(updatedSource?.metricTables).toBeNull();
    expect(updatedSource?.severityTextExpression).toBe('SeverityText');
  });

  it('DELETE /:id - deletes a source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    const source = await Source.create({
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
