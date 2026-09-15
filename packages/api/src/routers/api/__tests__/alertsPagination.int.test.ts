import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import {
  getLoggedInAgent,
  getServer,
  makeTile,
  randomMongoId,
} from '@/fixtures';
import Alert, { AlertSource, AlertState } from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import User from '@/models/user';
import Webhook, { WebhookDocument, WebhookService } from '@/models/webhook';

const MOCK_TILES = [makeTile()];

describe('alerts list paging and filtering', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];
  let user: Awaited<ReturnType<typeof getLoggedInAgent>>['user'];
  let webhook: WebhookDocument;
  let dashboardId: string;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
    webhook = await Webhook.create({
      name: 'Test Webhook',
      service: WebhookService.Slack,
      url: 'https://hooks.slack.com/test',
      team: team._id,
    });
    const dashboard = await agent
      .post('/dashboards')
      .send({ name: 'Test Dashboard', tiles: MOCK_TILES, tags: ['test'] })
      .expect(200);
    dashboardId = dashboard.body.id;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Written straight to Mongo rather than through POST /alerts: the create
  // endpoint derives displayName/tags when they're absent, and these tests need
  // documents that genuinely have none.
  const createAlert = (overrides: Record<string, unknown> = {}) =>
    Alert.create({
      team: team._id,
      channel: { type: 'webhook', webhookId: webhook._id.toString() },
      interval: '15m',
      threshold: 8,
      thresholdType: AlertThresholdType.ABOVE,
      source: AlertSource.TILE,
      dashboard: dashboardId,
      tileId: MOCK_TILES[0].id,
      createdBy: user._id,
      ...overrides,
    });

  const listIds = async (query = '') => {
    const res = await agent.get(`/alerts${query}`).expect(200);
    return res.body.data.map((alert: { _id: string }) => alert._id);
  };

  describe('unpaginated (no params)', () => {
    it('returns every alert in name order, with no page metadata', async () => {
      await createAlert({ displayName: 'Gamma' });
      await createAlert({ displayName: 'Alpha' });
      await createAlert({ displayName: 'Beta' });

      const res = await agent.get('/alerts').expect(200);

      expect(
        res.body.data.map((a: { displayName: string }) => a.displayName),
      ).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.nextCursor).toBeUndefined();
    });

    // Sorting runs on the stored displayName, so alerts without one lead the
    // page even though they render under a name derived from the dashboard.
    it('sorts alerts with no stored name first, rendering the derived name', async () => {
      await createAlert({ displayName: 'Alpha' });
      await createAlert();
      await createAlert({ displayName: null });

      const res = await agent.get('/alerts').expect(200);

      expect(
        res.body.data.map((a: { displayName: string }) => a.displayName),
      ).toEqual([
        'Test Dashboard - Test Chart',
        'Test Dashboard - Test Chart',
        'Alpha',
      ]);
      expect(res.body.data[0].tags).toEqual(['test']);
    });

    it('still populates the referenced dashboard, saved search and creator', async () => {
      const savedSearch = await SavedSearch.create({
        name: 'Checkout errors',
        source: new mongoose.Types.ObjectId(),
        team: team._id,
        tags: ['checkout'],
      });
      await createAlert({ displayName: 'A tile alert' });
      await createAlert({
        displayName: 'B search alert',
        source: AlertSource.SAVED_SEARCH,
        dashboard: undefined,
        tileId: undefined,
        savedSearch: savedSearch._id,
      });

      const res = await agent.get('/alerts').expect(200);
      const [tileAlert, searchAlert] = res.body.data;

      expect(tileAlert.dashboardId).toBe(dashboardId);
      expect(tileAlert.dashboard).toMatchObject({
        name: 'Test Dashboard',
        tiles: [{ id: MOCK_TILES[0].id }],
      });
      // Each row carries only what the client derives a display name from.
      // The ids moved to the flat dashboardId / savedSearchId above; the
      // parent's own tags and timestamps are not echoed per row.
      expect(tileAlert.dashboard._id).toBeUndefined();
      expect(tileAlert.dashboard.tags).toBeUndefined();
      expect(tileAlert.dashboard.updatedAt).toBeUndefined();
      expect(tileAlert.createdBy).toEqual({
        email: user.email,
        name: user.name,
      });
      expect(searchAlert.savedSearchId).toBe(savedSearch._id.toString());
      expect(searchAlert.savedSearch).toEqual({ name: 'Checkout errors' });
    });
  });

  describe('paging', () => {
    // Unnamed documents sort before every named one, so a walk over this set
    // has to cross the null -> string boundary; the duplicate 'Beta' has to
    // tie-break on _id. Both spellings of "unnamed" are here: the field
    // missing entirely, and an explicit null (which is what the create path
    // persists when there's nothing to derive a name from).
    const seedMixedNames = async () => {
      await createAlert({ displayName: 'Beta' });
      await createAlert({ displayName: 'Alpha' });
      await createAlert();
      await createAlert({ displayName: 'Beta' });
      await createAlert({ displayName: null });
    };

    const walk = async (limit: number) => {
      const ids: string[] = [];
      let cursor: string | undefined;
      let pages = 0;

      for (;;) {
        const query = cursor
          ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
          : `?limit=${limit}`;
        const res = await agent.get(`/alerts${query}`).expect(200);
        pages += 1;

        expect(res.body.data.length).toBeLessThanOrEqual(limit);
        ids.push(...res.body.data.map((a: { _id: string }) => a._id));

        if (!res.body.hasMore) {
          expect(res.body.nextCursor).toBeUndefined();
          return { ids, pages };
        }
        expect(res.body.nextCursor).toEqual(expect.any(String));
        cursor = res.body.nextCursor;
        expect(pages).toBeLessThan(20); // guard against a non-advancing cursor
      }
    };

    it('walks the full list without gaps or duplicates', async () => {
      await seedMixedNames();
      const expected = await listIds();

      const { ids, pages } = await walk(2);

      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(5);
      expect(pages).toBe(3);
    });

    it('advances one row at a time', async () => {
      await seedMixedNames();
      const expected = await listIds();

      const { ids } = await walk(1);

      expect(ids).toEqual(expected);
    });

    it('breaks ties between identical names on _id', async () => {
      await createAlert({ displayName: 'Same' });
      await createAlert({ displayName: 'Same' });
      await createAlert({ displayName: 'Same' });
      const expected = await listIds();

      const { ids } = await walk(1);

      expect(ids).toEqual(expected);
      expect(ids).toEqual([...ids].sort());
    });

    it('reports hasMore false on a page that exactly empties the list', async () => {
      await createAlert({ displayName: 'Alpha' });
      await createAlert({ displayName: 'Beta' });

      const res = await agent.get('/alerts?limit=2').expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.nextCursor).toBeUndefined();
    });
  });

  describe('filters', () => {
    it('filters by createdBy', async () => {
      const other = await User.create({
        email: 'other@example.test',
        name: 'Other',
        team: team._id,
      });
      await createAlert({ displayName: 'Mine' });
      const theirs = await createAlert({
        displayName: 'Theirs',
        createdBy: other._id,
      });

      expect(await listIds(`?createdBy=${other._id.toString()}`)).toEqual([
        theirs._id.toString(),
      ]);
    });

    it('matches any repeated tag', async () => {
      const both = await createAlert({
        displayName: 'Both',
        tags: ['prod', 'web'],
      });
      const one = await createAlert({ displayName: 'One', tags: ['prod'] });
      const other = await createAlert({ displayName: 'Other', tags: ['web'] });
      await createAlert({ displayName: 'Untouched', tags: ['staging'] });

      expect(await listIds('?tag=prod')).toHaveLength(2);
      // Union, not intersection: 'One' and 'Other' each carry one of the two.
      expect(await listIds('?tag=prod&tag=web')).toEqual([
        both._id.toString(),
        one._id.toString(),
        other._id.toString(),
      ]);
    });

    it('filters by state', async () => {
      const firing = await createAlert({
        displayName: 'Firing',
        state: AlertState.ALERT,
      });
      await createAlert({ displayName: 'Fine' });

      expect(await listIds('?state=ALERT')).toEqual([firing._id.toString()]);
      expect(await listIds('?state=ALERT&state=OK')).toHaveLength(2);
    });

    it('matches documents with no source field when filtering by saved_search', async () => {
      const savedSearch = await SavedSearch.create({
        name: 'Legacy search',
        source: new mongoose.Types.ObjectId(),
        team: team._id,
      });
      // The model defaults `source` to saved_search, so unset it to reproduce a
      // document written before the field existed.
      const legacy = await createAlert({
        displayName: 'Legacy',
        dashboard: undefined,
        tileId: undefined,
        savedSearch: savedSearch._id,
      });
      await Alert.updateOne({ _id: legacy._id }, { $unset: { source: 1 } });
      const tile = await createAlert({ displayName: 'Tile' });

      expect(await listIds('?source=saved_search')).toEqual([
        legacy._id.toString(),
      ]);
      expect(await listIds('?source=tile')).toEqual([tile._id.toString()]);
      expect(await listIds('?source=tile&source=saved_search')).toHaveLength(2);
    });

    it('searches display names case-insensitively, treating metacharacters literally', async () => {
      const errors = await createAlert({ displayName: 'Checkout ERRORS' });
      await createAlert({ displayName: 'Latency' });
      const literal = await createAlert({ displayName: 'a.b(c' });

      expect(await listIds('?search=errors')).toEqual([errors._id.toString()]);
      expect(await listIds('?search=out%20ERR')).toEqual([
        errors._id.toString(),
      ]);
      expect(await listIds('?search=a.b(')).toEqual([literal._id.toString()]);
      expect(await listIds('?search=a%3Fb(')).toEqual([]);
    });

    // The next two cases pin the residual gap: the row renders the value
    // derived from the referenced dashboard, but filters run against what Mongo
    // holds, so an alert the startup backfill missed can be read yet not found.
    it('cannot match an alert whose tags were never stored', async () => {
      const untagged = await createAlert({ displayName: 'Untagged' });

      const res = await agent.get('/alerts').expect(200);
      expect(res.body.data[0]).toMatchObject({
        _id: untagged._id.toString(),
        tags: ['test'],
      });
      expect(await listIds('?tag=test')).toEqual([]);
    });

    it('cannot match an alert whose display name was never stored', async () => {
      const unnamed = await createAlert();

      const res = await agent.get('/alerts').expect(200);
      expect(res.body.data[0]).toMatchObject({
        _id: unnamed._id.toString(),
        displayName: 'Test Dashboard - Test Chart',
      });
      expect(await listIds('?search=Test%20Dashboard')).toEqual([]);
    });

    it('combines a filter with paging', async () => {
      await createAlert({ displayName: 'Alpha', tags: ['prod'] });
      await createAlert({ displayName: 'Beta', tags: ['prod'] });
      await createAlert({ displayName: 'Gamma' });

      const first = await agent.get('/alerts?limit=1&tag=prod').expect(200);
      expect(first.body.data[0].displayName).toBe('Alpha');
      expect(first.body.hasMore).toBe(true);

      const second = await agent
        .get(
          `/alerts?limit=1&tag=prod&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        )
        .expect(200);
      expect(second.body.data[0].displayName).toBe('Beta');
      expect(second.body.hasMore).toBe(false);
    });
  });

  describe('rejected requests', () => {
    it('rejects an otherwise valid cursor with no limit to continue', async () => {
      await createAlert({ displayName: 'Alpha' });
      await createAlert({ displayName: 'Beta' });
      const first = await agent.get('/alerts?limit=1').expect(200);

      await agent
        .get(`/alerts?cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .expect(400);
    });

    it.each([
      ['a malformed cursor', '/alerts?limit=2&cursor=not-a-cursor'],
      [
        'a cursor whose id is not an ObjectId',
        `/alerts?limit=2&cursor=${Buffer.from(
          JSON.stringify({ n: 'a', id: 'nope' }),
        ).toString('base64url')}`,
      ],
      ['a non-ObjectId createdBy', '/alerts?createdBy=nope'],
      ['limit=0', '/alerts?limit=0'],
      ['limit above the cap', '/alerts?limit=501'],
      ['an unknown source', '/alerts?source=nope'],
      ['an unknown state', '/alerts?state=nope'],
    ])('rejects %s', async (_label, path) => {
      await createAlert({ displayName: 'Alpha' });
      await agent.get(path).expect(400);
    });
  });

  it('does not leak another team’s alerts', async () => {
    await createAlert({ displayName: 'Mine' });
    await createAlert({ displayName: 'Theirs', team: randomMongoId() });

    expect(await listIds()).toHaveLength(1);
    expect(await listIds('?limit=10')).toHaveLength(1);
  });
});
