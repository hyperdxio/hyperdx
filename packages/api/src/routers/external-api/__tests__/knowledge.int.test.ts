import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';
import { SuperAgentTest } from 'supertest';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import Team from '@/models/team';
import User from '@/models/user';

const BASE = '/api/v2/knowledge';

describe('External API v2 knowledge incidents', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let accessKey: string;
  let userId: string;

  beforeAll(async () => {
    await server.start();
  });
  afterEach(async () => {
    await server.clearDBs();
  });
  afterAll(async () => {
    await server.stop();
  });

  async function createTraceSource(team: Types.ObjectId) {
    const connection = await Connection.create({
      team,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    await Source.create({
      kind: SourceKind.Trace,
      team,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      durationExpression: 'Duration',
      durationPrecision: 9,
      serviceNameExpression: 'ServiceName',
      statusCodeExpression: 'StatusCode',
      eventAttributesExpression: 'SpanAttributes',
    });
  }

  async function setup({ flag = true, source = true } = {}) {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    accessKey = result.user.accessKey;
    userId = result.user._id.toString();
    if (flag) {
      await Team.updateOne(
        { _id: result.team._id },
        { isKnowledgeGraphEnabled: true },
      );
    }
    if (source) await createTraceSource(result.team._id);
  }

  const call = (
    method: 'get' | 'post' | 'delete',
    url: string,
    key = accessKey,
  ) => {
    const full = `${BASE}${url}`;
    const req =
      method === 'get'
        ? agent.get(full)
        : method === 'post'
          ? agent.post(full)
          : agent.delete(full);
    return req.set('Authorization', `Bearer ${key}`);
  };

  it('runs the full incident lifecycle', async () => {
    await setup();
    const open = await call('post', '/incidents')
      .send({ title: 'kg-rest checkout down', alertingService: 'checkout' })
      .expect(201);
    const id = open.body.data.incident_id;
    expect(open.body.data.status).toBe('open');
    expect(open.body.data).not.toHaveProperty('embedding');

    const action = await call('post', `/incidents/${id}/actions`)
      .send({ actionType: 'query', summary: 'checked errors' })
      .expect(201);
    expect(action.body.data.seq).toBe(1);

    const resolved = await call('post', `/incidents/${id}/resolve`)
      .send({
        rootCause: 'bad deploy',
        rootCauseNode: 'service:checkout',
        resolution: 'rollback',
        outcomes: [{ seq: 1, outcome: 'led_to_fix' }],
      })
      .expect(200);
    expect(resolved.body.data.status).toBe('resolved');
    expect(resolved.body.data).not.toHaveProperty('embedding');
    await call('post', `/incidents/${id}/actions`)
      .send({ actionType: 'note', summary: 'late' })
      .expect(409);

    await call('post', `/incidents/${id}/resolve`)
      .send({
        rootCause: 'x',
        rootCauseNode: 'service:checkout',
        resolution: 'y',
      })
      .expect(409);

    const confirmed = await call('post', `/incidents/${id}/confirm`).expect(
      200,
    );
    expect(confirmed.body.data.confirmed_by).toBe(userId);
    expect(confirmed.body.data).not.toHaveProperty('embedding');

    const similar = await call(
      'get',
      '/incidents/similar?service=checkout&symptomKeys=service:checkout',
    ).expect(200);
    expect(similar.body.data[0].incident.incident_id).toBe(id);
    expect(similar.body.data[0].score).toBeGreaterThanOrEqual(0.5);
    expect(similar.body.data[0].incident).not.toHaveProperty('embedding');

    const one = await call('get', `/incidents/${id}`).expect(200);
    expect(one.body.data.incident.incident_id).toBe(id);
    expect(one.body.data.incident).not.toHaveProperty('embedding');
    expect(one.body.data.actions.map((a: { seq: number }) => a.seq)).toEqual([
      1,
    ]);

    const playbook = await call('get', `/incidents/${id}/playbook`).expect(200);
    expect(playbook.body.data.steps).toHaveLength(1);

    const del = await call('delete', '/incidents?titlePrefix=kg-rest').expect(
      200,
    );
    expect(del.body.data.deleted).toBe(1);
  });

  it('maps errors to statuses', async () => {
    await setup();
    await call('delete', '/incidents').expect(400);
    await call('delete', '/incidents?titlePrefix=ab').expect(400);
    await call('get', '/incidents/similar').expect(400);
    await call('post', '/incidents/not-a-uuid/confirm').expect(400);
    await call('get', '/incidents/2f1b7b8e-6a0e-4c3a-9d55-0c1d2e3f4a5b').expect(
      404,
    );
    await call(
      'post',
      '/incidents/2f1b7b8e-6a0e-4c3a-9d55-0c1d2e3f4a5b/confirm',
    ).expect(404);
    await call('post', '/incidents').send({ title: '' }).expect(400);
    const open = await call('post', '/incidents')
      .send({ title: 'kg-rest err', alertingService: 'checkout' })
      .expect(201);
    await call(
      'post',
      `/incidents/${open.body.data.incident_id}/confirm`,
    ).expect(409);
    await call('post', `/incidents/${open.body.data.incident_id}/actions`)
      .send({ actionType: 'query', summary: 's' })
      .expect(201);
    await call('post', `/incidents/${open.body.data.incident_id}/resolve`)
      .send({
        rootCause: 'x',
        rootCauseNode: 'service:checkout',
        resolution: 'y',
        outcomes: [{ seq: 9, outcome: 'useful' }],
      })
      .expect(400);
  });

  it('returns 404 when the flag is off', async () => {
    await setup({ flag: false });
    const res = await call('get', '/incidents/similar?service=checkout').expect(
      404,
    );
    expect(res.body).toEqual({ message: 'Not found' });
  });

  it('returns 412 when there is no trace source', async () => {
    await setup({ source: false });
    const res = await call('post', '/incidents')
      .send({ title: 'kg-rest nosrc', alertingService: 'checkout' })
      .expect(412);
    expect(res.body.message).toEqual(expect.any(String));
  });

  it('hides incidents from other teams', async () => {
    await setup();
    const teamB = await Team.create({
      name: 'Team B',
      isKnowledgeGraphEnabled: true,
    });
    const userB = await User.create({
      email: 'team-b@example.com',
      name: 'B',
      team: teamB._id,
    });
    await createTraceSource(teamB._id);
    const keyB = userB.accessKey;

    const open = await call('post', '/incidents')
      .send({ title: 'kg-iso secret', alertingService: 'checkout' })
      .expect(201);
    const id = open.body.data.incident_id;
    await call('post', `/incidents/${id}/actions`)
      .send({ actionType: 'query', summary: 's' })
      .expect(201);
    await call('post', `/incidents/${id}/resolve`)
      .send({
        rootCause: 'x',
        rootCauseNode: 'service:checkout',
        resolution: 'y',
      })
      .expect(200);
    await call('post', `/incidents/${id}/confirm`).expect(200);

    await call('post', `/incidents/${id}/confirm`, keyB).expect(404);
    await call('get', `/incidents/${id}/playbook`, keyB).expect(404);
    await call('get', `/incidents/${id}`, keyB).expect(404);
    expect(
      (await call('get', '/incidents', keyB).expect(200)).body.data,
    ).toEqual([]);
    await call('post', `/incidents/${id}/actions`, keyB)
      .send({ actionType: 'query', summary: 's' })
      .expect(404);
    await call('post', `/incidents/${id}/resolve`, keyB)
      .send({
        rootCause: 'x',
        rootCauseNode: 'service:checkout',
        resolution: 'y',
      })
      .expect(404);

    for (const flag of ['false', 'true']) {
      const similar = await call(
        'get',
        `/incidents/similar?service=checkout&includeUnconfirmed=${flag}`,
        keyB,
      ).expect(200);
      expect(similar.body.data).toEqual([]);
    }

    const del = await call(
      'delete',
      '/incidents?titlePrefix=kg-iso',
      keyB,
    ).expect(200);
    expect(del.body.data.deleted).toBe(0);

    await call('get', `/incidents/${id}/playbook`).expect(200);
  });
});
