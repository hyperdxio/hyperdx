import mongoose from 'mongoose';

import { createTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import { backfillAlertNameAndTags } from '@/migrations';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
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

describe('backfillAlertNameAndTags', () => {
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
        name: 'Custom name',
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

    await backfillAlertNameAndTags();

    const byId = async (id: mongoose.Types.ObjectId | string) =>
      Alert.findById(id).lean();

    expect(await byId(searchAlert._id)).toMatchObject({
      name: 'Error spikes',
      tags: ['errors', 'prod'],
    });
    expect(await byId(tileAlert._id)).toMatchObject({
      name: 'Service health P95 latency',
      tags: ['infra'],
    });
    expect((await byId(missingTileAlert._id))?.name).toBe(
      'Service health Tile',
    );
    expect(await byId(namedAlert._id)).toMatchObject({
      name: 'Custom name',
      tags: ['errors', 'prod'],
    });
    expect(await byId(taggedAlert._id)).toMatchObject({
      name: 'Error spikes',
      tags: ['keep-me'],
    });
    expect((await byId(inlineAlert._id))?.name).toBe('CPU usage');
    expect(await byId(legacyAlertId)).toMatchObject({ name: 'Error spikes' });

    const untagged = await byId(untaggedSearchAlert._id);
    expect(untagged?.name).toBe('Untagged search');
    expect(untagged?.tags).toBeUndefined();

    const dangling = await byId(danglingAlert._id);
    expect(dangling?.name).toBeUndefined();
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

    await backfillAlertNameAndTags();
    expect((await Alert.findById(alert._id).lean())?.name).toBe('First name');

    await SavedSearch.updateOne(
      { _id: savedSearch._id },
      { name: 'Second name' },
    );
    await Alert.updateOne({ _id: otherAlert._id }, { $unset: { name: '' } });

    await backfillAlertNameAndTags();
    expect((await Alert.findById(alert._id).lean())?.name).toBe('First name');
    expect((await Alert.findById(otherAlert._id).lean())?.name).toBe(
      'Second name',
    );
  });
});
