import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import { Source } from '@/models/source';

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

  describe('querySettings validation', () => {
    it('POST / - accepts and persists valid querySettings', async () => {
      const { agent } = await getLoggedInAgent(server);

      const querySettings = [
        { setting: 'max_execution_time', value: '60' },
        { setting: 'max_memory_usage', value: '10000000000' },
      ];

      const response = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, querySettings })
        .expect(200);

      expect(response.body.querySettings).toEqual(querySettings);

      const sources = await Source.find({}).lean();
      expect(sources).toHaveLength(1);
      expect(sources[0]?.querySettings).toEqual(querySettings);
    });

    it('POST / - accepts querySettings at the limit of 10 items', async () => {
      const { agent } = await getLoggedInAgent(server);

      const querySettings = Array.from({ length: 10 }, (_, i) => ({
        setting: `setting_${i}`,
        value: `value_${i}`,
      }));

      const response = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, querySettings })
        .expect(200);

      expect(response.body.querySettings).toHaveLength(10);

      const sources = await Source.find({}).lean();
      expect(sources[0]?.querySettings).toHaveLength(10);
    });

    it('POST / - rejects querySettings exceeding the limit of 10', async () => {
      const { agent } = await getLoggedInAgent(server);

      const querySettings = Array.from({ length: 11 }, (_, i) => ({
        setting: `setting_${i}`,
        value: `value_${i}`,
      }));

      const response = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, querySettings });

      expect(response.status).toBe(400);
      const sources = await Source.find({}).lean();
      expect(sources).toHaveLength(0);
    });

    it('POST / - returns 400 when querySettings item has empty setting or value', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          querySettings: [{ setting: '', value: 'x' }],
        })
        .expect(400);

      await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          querySettings: [{ setting: 'x', value: '' }],
        })
        .expect(400);
    });

    it('PUT /:id - accepts and persists valid querySettings', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await Source.create({
        ...MOCK_SOURCE,
        team: team._id,
      });

      const querySettings = [{ setting: 'max_execution_time', value: '120' }];

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          querySettings,
        })
        .expect(200);

      const updated = await Source.findById(source._id).lean();
      expect(updated?.querySettings).toEqual(querySettings);
    });

    it('PUT /:id - rejects querySettings exceeding the limit of 10', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await Source.create({
        ...MOCK_SOURCE,
        team: team._id,
      });

      const querySettings = Array.from({ length: 11 }, (_, i) => ({
        setting: `setting_${i}`,
        value: `value_${i}`,
      }));

      const response = await agent.put(`/sources/${source._id}`).send({
        ...MOCK_SOURCE,
        id: source._id.toString(),
        querySettings,
      });

      expect(response.status).toBe(400);
      const updated = await Source.findById(source._id).lean();
      expect(updated?.querySettings).toEqual([]); // defaults to [] when source created
    });
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
    expect(createdSource).toHaveProperty('metricTables');

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
    if (updatedSource?.kind !== SourceKind.Trace) {
      expect(updatedSource?.kind).toBe(SourceKind.Trace);
      throw new Error('Source did not update to trace');
    }
    expect(updatedSource.kind).toBe(SourceKind.Trace);
    expect(updatedSource).not.toHaveProperty('metricTables');
    expect(updatedSource.durationExpression).toBe('Duration');
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
    if (updatedSource?.kind !== SourceKind.Metric) {
      expect(updatedSource?.kind).toBe(SourceKind.Metric);
      throw new Error('Source is not a metric');
    }
    expect(updatedSource.metricTables).toMatchObject({
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
    if (updatedSource?.kind !== SourceKind.Log) {
      expect(updatedSource?.kind).toBe(SourceKind.Log);
      throw new Error('Source did not update to log');
    }
    expect(updatedSource).not.toHaveProperty('metricTables');
    expect(updatedSource.severityTextExpression).toBe('SeverityText');
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
