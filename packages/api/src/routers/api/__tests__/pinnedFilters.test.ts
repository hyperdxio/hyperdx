import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import { Source } from '@/models/source';

const MOCK_SOURCE: Omit<Extract<TSource, { kind: 'log' }>, 'id'> = {
  kind: SourceKind.Log,
  name: 'Test Source',
  connection: new Types.ObjectId().toString(),
  from: { databaseName: 'test_db', tableName: 'test_table' },
  timestampValueExpression: 'timestamp',
  defaultTableSelectExpression: 'body',
};

describe('pinnedFilters router', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];
  let sourceId: string;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;

    // Create a real source owned by this team
    const source = await Source.create({ ...MOCK_SOURCE, team: team._id });
    sourceId = source._id.toString();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('GET /pinned-filters', () => {
    it('returns null when no pinned filters exist', async () => {
      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).toBeNull();
    });

    it('rejects invalid source id', async () => {
      await agent.get('/pinned-filters?source=not-an-objectid').expect(400);
    });

    it('rejects missing source param', async () => {
      await agent.get('/pinned-filters').expect(400);
    });

    it('returns 404 for a source not owned by the team', async () => {
      const foreignSourceId = new Types.ObjectId().toString();
      await agent.get(`/pinned-filters?source=${foreignSourceId}`).expect(404);
    });
  });

  describe('PUT /pinned-filters', () => {
    it('can create pinned filters', async () => {
      const res = await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName', 'SeverityText'],
          filters: { ServiceName: ['web', 'api'] },
        })
        .expect(200);

      expect(res.body.fields).toEqual(['ServiceName', 'SeverityText']);
      expect(res.body.filters).toEqual({ ServiceName: ['web', 'api'] });
      expect(res.body.id).toBeDefined();
    });

    it('upserts on repeated PUT', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      const res = await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName', 'SeverityText'],
          filters: { ServiceName: ['web', 'api'], SeverityText: ['error'] },
        })
        .expect(200);

      expect(res.body.fields).toEqual(['ServiceName', 'SeverityText']);
      expect(res.body.filters).toEqual({
        ServiceName: ['web', 'api'],
        SeverityText: ['error'],
      });
    });

    it('rejects invalid source id', async () => {
      await agent
        .put('/pinned-filters')
        .send({ source: 'not-valid', fields: [], filters: {} })
        .expect(400);
    });

    it('returns 404 for a source not owned by the team', async () => {
      const foreignSourceId = new Types.ObjectId().toString();
      await agent
        .put('/pinned-filters')
        .send({ source: foreignSourceId, fields: [], filters: {} })
        .expect(404);
    });
  });

  describe('GET + PUT round-trip', () => {
    it('returns data after PUT', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).not.toBeNull();
      expect(res.body.team.fields).toEqual(['ServiceName']);
      expect(res.body.team.filters).toEqual({ ServiceName: ['web'] });
    });

    it('can reset by sending empty fields and filters', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      await agent
        .put('/pinned-filters')
        .send({ source: sourceId, fields: [], filters: {} })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).not.toBeNull();
      expect(res.body.team.fields).toEqual([]);
      expect(res.body.team.filters).toEqual({});
    });
  });

  describe('source scoping', () => {
    it('pins are scoped to their source', async () => {
      const source2 = await Source.create({ ...MOCK_SOURCE, team: team._id });

      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${source2._id}`)
        .expect(200);

      expect(res.body.team).toBeNull();
    });
  });

  // Note: cross-team isolation (Team B cannot read Team A's pins) is enforced
  // by the MongoDB query filtering on teamId AND the source ownership check
  // (getSource validates source.team === teamId). Multi-team integration tests
  // are not possible in this single-team environment (register returns 409).

  describe('filter values with booleans', () => {
    it('supports boolean values in filters', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['isRootSpan'],
          filters: { isRootSpan: [true, false] },
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team.filters).toEqual({ isRootSpan: [true, false] });
    });
  });
});
