import mongoose from 'mongoose';

import { createTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import {
  backfillAlertDisplayFields,
  dropReplacedAlertHistoryIndex,
} from '@/migrations';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';

const baseAlert = {
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
  interval: '5m',
  channel: { type: null },
} as const;

const makeSavedSearch = (
  team: mongoose.Types.ObjectId,
  fields: { name: string; tags?: string[] },
) =>
  new SavedSearch({
    team,
    source: new mongoose.Types.ObjectId(),
    select: '',
    where: '',
    whereLanguage: 'lucene',
    orderBy: '',
    ...fields,
  }).save();

describe('backfillAlertDisplayFields', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  it('backfills missing alert names and tags from the referenced documents', async () => {
    const team = await createTeam({ name: 'Test team' });
    const savedSearch = await makeSavedSearch(team._id, {
      name: 'Error spikes',
      tags: ['errors', 'prod'],
    });
    const untaggedSearch = await makeSavedSearch(team._id, {
      name: 'Untagged search',
    });
    const dashboard = await new Dashboard({
      team: team._id,
      name: 'Service health',
      tags: ['infra'],
      tiles: [{ id: 'tile-1', config: { name: 'P95 latency' } }],
    }).save();

    const [
      searchAlert,
      untaggedSearchAlert,
      tileAlert,
      missingTileAlert,
      namedAlert,
      taggedAlert,
      clearedTagsAlert,
      danglingAlert,
      inlineAlert,
    ] = await Alert.create([
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: untaggedSearch._id,
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: 'tile-1',
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: 'deleted-tile',
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        displayName: 'Custom name',
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        tags: ['keep-me'],
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        tags: [],
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: new mongoose.Types.ObjectId(),
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.INLINE,
        chartConfig: { name: 'CPU usage', displayType: 'line' },
      },
    ]);

    const { insertedId: legacyAlertId } = await Alert.collection.insertOne({
      ...baseAlert,
      team: team._id,
      savedSearch: savedSearch._id,
    });

    await backfillAlertDisplayFields();

    const byId = async (id: mongoose.Types.ObjectId | string) =>
      Alert.findById(id).lean();

    expect(await byId(searchAlert._id)).toMatchObject({
      displayName: 'Error spikes',
      tags: ['errors', 'prod'],
    });
    expect(await byId(tileAlert._id)).toMatchObject({
      displayName: 'Service health - P95 latency',
      tags: ['infra'],
    });
    expect((await byId(missingTileAlert._id))?.displayName).toBe(
      'Service health - Tile',
    );
    expect(await byId(namedAlert._id)).toMatchObject({
      displayName: 'Custom name',
      tags: ['errors', 'prod'],
    });
    expect(await byId(taggedAlert._id)).toMatchObject({
      displayName: 'Error spikes',
      tags: ['keep-me'],
    });
    expect(await byId(clearedTagsAlert._id)).toMatchObject({
      displayName: 'Error spikes',
      tags: [],
    });
    expect(await byId(inlineAlert._id)).toMatchObject({
      displayName: 'CPU usage',
      tags: [],
    });
    expect(await byId(legacyAlertId)).toMatchObject({
      displayName: 'Error spikes',
    });

    const untagged = await byId(untaggedSearchAlert._id);
    expect(untagged?.displayName).toBe('Untagged search');
    expect(untagged?.tags).toEqual([]);

    expect((await byId(searchAlert._id))?.updatedAt).toEqual(
      searchAlert.updatedAt,
    );

    const dangling = await byId(danglingAlert._id);
    expect(dangling?.displayName).toBeUndefined();
    expect(dangling?.tags).toBeUndefined();
  });

  it('is idempotent: re-running fills newly missing fields and never touches populated ones', async () => {
    const team = await createTeam({ name: 'Test team' });
    const savedSearch = await makeSavedSearch(team._id, { name: 'First name' });
    const [alert, otherAlert] = await Alert.create([
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
      },
    ]);

    await backfillAlertDisplayFields();
    expect((await Alert.findById(alert._id).lean())?.displayName).toBe(
      'First name',
    );

    await SavedSearch.updateOne(
      { _id: savedSearch._id },
      { name: 'Second name' },
    );
    await Alert.updateOne(
      { _id: otherAlert._id },
      { $unset: { displayName: '' } },
    );

    await backfillAlertDisplayFields();
    expect((await Alert.findById(alert._id).lean())?.displayName).toBe(
      'First name',
    );
    expect((await Alert.findById(otherAlert._id).lean())?.displayName).toBe(
      'Second name',
    );
  });
});

describe('dropReplacedAlertHistoryIndex', () => {
  const OLD = 'alert_1_group_1_createdAt_-1';
  const NEW = 'alert_1_group_1_createdAt_-1_state_1';
  const indexNames = async () =>
    (await AlertHistory.collection.indexes()).map(i => i.name);

  beforeAll(async () => {
    await connectDB();
    await AlertHistory.init();
  });

  afterAll(async () => {
    await AlertHistory.createIndexes();
    await closeDB();
  });

  it('drops the old index once the new one exists, and is idempotent', async () => {
    await AlertHistory.createIndexes();
    await AlertHistory.collection.createIndex(
      { alert: 1, group: 1, createdAt: -1 },
      { name: OLD },
    );
    expect(await indexNames()).toEqual(expect.arrayContaining([OLD, NEW]));

    await dropReplacedAlertHistoryIndex();
    await dropReplacedAlertHistoryIndex();

    const names = await indexNames();
    expect(names).toContain(NEW);
    expect(names).not.toContain(OLD);
  });

  it('keeps the old index while the new one is missing', async () => {
    await AlertHistory.collection.createIndex(
      { alert: 1, group: 1, createdAt: -1 },
      { name: OLD },
    );
    await AlertHistory.collection.dropIndex(NEW);

    await dropReplacedAlertHistoryIndex();

    expect(await indexNames()).toContain(OLD);
  });
});
