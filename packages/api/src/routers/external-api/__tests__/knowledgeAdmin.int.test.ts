import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';
import { SuperAgentTest } from 'supertest';

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

const BASE = '/api/v2/knowledge';

describe('External API v2 knowledge settings and review', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let accessKey: string;
  let teamId: Types.ObjectId;

  beforeAll(async () => {
    await server.start();
  });
  afterEach(async () => {
    await server.clearDBs();
  });
  afterAll(async () => {
    await server.stop();
  });

  async function createSource(team: Types.ObjectId, kind = SourceKind.Trace) {
    const connection = await Connection.create({
      team,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const trace = kind === SourceKind.Trace;
    const source = await Source.create({
      kind,
      team,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: trace ? DEFAULT_TRACES_TABLE : DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: trace ? 'Traces' : 'Logs',
      ...(trace
        ? {
            traceIdExpression: 'TraceId',
            spanIdExpression: 'SpanId',
            parentSpanIdExpression: 'ParentSpanId',
            spanNameExpression: 'SpanName',
            spanKindExpression: 'SpanKind',
            durationExpression: 'Duration',
            durationPrecision: 9,
            serviceNameExpression: 'ServiceName',
            statusCodeExpression: 'StatusCode',
          }
        : {}),
    });
    return source._id.toString();
  }

  async function setup(flag = true) {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    accessKey = result.user.accessKey;
    teamId = result.team._id;
    if (flag) {
      await Team.updateOne({ _id: teamId }, { isKnowledgeGraphEnabled: true });
    }
  }

  const call = (method: 'get' | 'post' | 'put', url: string) => {
    const full = `${BASE}${url}`;
    const req =
      method === 'get'
        ? agent.get(full)
        : method === 'post'
          ? agent.post(full)
          : agent.put(full);
    return req.set('Authorization', `Bearer ${accessKey}`);
  };
  const putSettings = (body: object) => call('put', '/settings').send(body);

  it('lets a team with several trace sources and none set pick one', async () => {
    await setup();
    const first = await createSource(teamId);
    await createSource(teamId);
    await call('post', '/incidents')
      .send({ title: 'kg-admin x', alertingService: 'checkout' })
      .expect(412);

    expect((await call('get', '/settings').expect(200)).body.data).toEqual({
      traceSourceId: null,
      includeUnconfirmed: false,
    });
    const put = await putSettings({ traceSourceId: first }).expect(200);
    expect(put.body.data).toEqual({
      traceSourceId: first,
      includeUnconfirmed: false,
    });
    await call('post', '/incidents')
      .send({ title: 'kg-admin x', alertingService: 'checkout' })
      .expect(201);

    await putSettings({ includeUnconfirmed: true }).expect(200);
    expect((await call('get', '/settings').expect(200)).body.data).toEqual({
      traceSourceId: first,
      includeUnconfirmed: true,
    });
    const cleared = await putSettings({
      traceSourceId: null,
      includeUnconfirmed: false,
    }).expect(200);
    expect(cleared.body.data).toEqual({
      traceSourceId: null,
      includeUnconfirmed: false,
    });
  });

  it('rejects sources that are not trace sources of the team', async () => {
    await setup();
    const logs = await createSource(teamId, SourceKind.Log);
    const otherTeam = await Team.create({ name: 'Other' });
    const theirs = await createSource(otherTeam._id);
    for (const traceSourceId of [logs, theirs, 'not-an-id']) {
      await putSettings({ traceSourceId }).expect(400);
    }
    await putSettings({ includeUnconfirmed: 'yes' }).expect(400);
    expect((await call('get', '/settings').expect(200)).body.data).toEqual({
      traceSourceId: null,
      includeUnconfirmed: false,
    });
  });

  it('returns 404 for settings when the flag is off', async () => {
    await setup(false);
    await call('get', '/settings').expect(404);
    await putSettings({ includeUnconfirmed: true }).expect(404);
  });

  it('lists incidents for review by status and confirmation', async () => {
    await setup();
    await createSource(teamId);
    const open = (title: string) =>
      call('post', '/incidents')
        .send({ title, alertingService: 'checkout' })
        .expect(201)
        .then(r => String(r.body.data.incident_id));
    const resolve = (id: string) =>
      call('post', `/incidents/${id}/resolve`)
        .send({ rootCause: 'x', rootCauseNode: 'checkout', resolution: 'y' })
        .expect(200);
    const a = await open('kg-list a');
    const b = await open('kg-list b');
    await open('kg-list c');
    await resolve(a);
    await resolve(b);
    await call('post', `/incidents/${a}/confirm`).expect(200);

    const titles = async (query: string) =>
      (await call('get', `/incidents${query}`).expect(200)).body.data
        .map((i: { title: string }) => i.title)
        .sort();
    expect(await titles('')).toEqual(['kg-list a', 'kg-list b', 'kg-list c']);
    expect(await titles('?status=open')).toEqual(['kg-list c']);
    expect(await titles('?confirmed=true')).toEqual(['kg-list a']);
    expect(await titles('?status=resolved&confirmed=false')).toEqual([
      'kg-list b',
    ]);
    const list = await call('get', '/incidents').expect(200);
    expect(list.body.data[0]).not.toHaveProperty('embedding');
    await call('get', '/incidents?status=closed').expect(400);
  });
});
