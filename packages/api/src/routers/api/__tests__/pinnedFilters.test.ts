import mongoose from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';

describe('pinnedFilters router', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let sourceId: string;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    sourceId = new mongoose.Types.ObjectId().toString();
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
        .send({
          source: 'not-valid',
          fields: [],
          filters: {},
        })
        .expect(400);
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

  describe('team scoping', () => {
    it('does not leak pinned filters between teams', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      const { agent: agentB } = await getLoggedInAgent(server);

      const res = await agentB
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).toBeNull();
    });
  });

  describe('source scoping', () => {
    it('pins are scoped to their source', async () => {
      const sourceId2 = new mongoose.Types.ObjectId().toString();

      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId2}`)
        .expect(200);

      expect(res.body.team).toBeNull();
    });
  });

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
