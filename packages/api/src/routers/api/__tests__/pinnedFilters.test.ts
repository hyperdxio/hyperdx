import mongoose from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';

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
    sourceId = new mongoose.Types.ObjectId().toString();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('GET /pinned-filters', () => {
    it('returns null for team and personal when no pinned filters exist', async () => {
      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).toBeNull();
      expect(res.body.personal).toBeNull();
    });

    it('rejects invalid source id', async () => {
      await agent.get('/pinned-filters?source=not-an-objectid').expect(400);
    });

    it('rejects missing source param', async () => {
      await agent.get('/pinned-filters').expect(400);
    });
  });

  describe('PUT /pinned-filters', () => {
    it('can create team-level pinned filters', async () => {
      const res = await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: ['ServiceName', 'SeverityText'],
          filters: { ServiceName: ['web', 'api'] },
        })
        .expect(200);

      expect(res.body.fields).toEqual(['ServiceName', 'SeverityText']);
      expect(res.body.filters).toEqual({ ServiceName: ['web', 'api'] });
      expect(res.body.id).toBeDefined();
    });

    it('can create personal pinned filters', async () => {
      const res = await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'personal',
          fields: ['level'],
          filters: { level: ['error'] },
        })
        .expect(200);

      expect(res.body.fields).toEqual(['level']);
      expect(res.body.filters).toEqual({ level: ['error'] });
    });

    it('upserts team-level pinned filters on repeated PUT', async () => {
      // First write
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      // Second write overwrites
      const res = await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
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
          scope: 'team',
          fields: [],
          filters: {},
        })
        .expect(400);
    });

    it('rejects invalid scope', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'global',
          fields: [],
          filters: {},
        })
        .expect(400);
    });
  });

  describe('GET + PUT round-trip', () => {
    it('returns team data after PUT with scope=team', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
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
      expect(res.body.personal).toBeNull();
    });

    it('returns personal data after PUT with scope=personal', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'personal',
          fields: ['level'],
          filters: { level: ['info'] },
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).toBeNull();
      expect(res.body.personal).not.toBeNull();
      expect(res.body.personal.fields).toEqual(['level']);
      expect(res.body.personal.filters).toEqual({ level: ['info'] });
    });

    it('returns both team and personal data independently', async () => {
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'personal',
          fields: ['level'],
          filters: { level: ['error'] },
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      expect(res.body.team).not.toBeNull();
      expect(res.body.team.fields).toEqual(['ServiceName']);
      expect(res.body.personal).not.toBeNull();
      expect(res.body.personal.fields).toEqual(['level']);
    });

    it('can reset pinned filters by sending empty fields and filters', async () => {
      // First set some pins
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      // Reset
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: [],
          filters: {},
        })
        .expect(200);

      const res = await agent
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      // Still returns the document, but with empty fields/filters
      expect(res.body.team).not.toBeNull();
      expect(res.body.team.fields).toEqual([]);
      expect(res.body.team.filters).toEqual({});
    });
  });

  describe('team scoping', () => {
    it('does not leak pinned filters between teams', async () => {
      // User A pins filters
      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      // User B on a different team
      const { agent: agentB } = await getLoggedInAgent(server);

      const res = await agentB
        .get(`/pinned-filters?source=${sourceId}`)
        .expect(200);

      // B should not see A's pins
      expect(res.body.team).toBeNull();
      expect(res.body.personal).toBeNull();
    });
  });

  describe('source scoping', () => {
    it('pins are scoped to their source', async () => {
      const sourceId2 = new mongoose.Types.ObjectId().toString();

      await agent
        .put('/pinned-filters')
        .send({
          source: sourceId,
          scope: 'team',
          fields: ['ServiceName'],
          filters: { ServiceName: ['web'] },
        })
        .expect(200);

      // Different source should have no pins
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
          scope: 'team',
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
