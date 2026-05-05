import { SourceKind } from '@berg/common-utils/dist/types';
import mongoose from 'mongoose';

import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import { Source } from '@/models/source';

describe('Source model (Berg Table kind)', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  it('accepts a Table-kind source with required fields', async () => {
    const teamId = new mongoose.Types.ObjectId();
    const doc = await Source.create({
      kind: SourceKind.Table,
      team: teamId,
      catalog: 's3tablescatalog/analytics-bucket',
      database: 'analytics_db',
      table: 'events',
      displayName: 'events',
    });
    expect(doc.kind).toBe(SourceKind.Table);
    expect(doc.catalog).toBe('s3tablescatalog/analytics-bucket');
    expect(doc.database).toBe('analytics_db');
    expect(doc.table).toBe('events');
    expect(doc.displayName).toBe('events');
  });

  it('accepts optional timestampColumn / defaultSort / defaultColumns', async () => {
    const teamId = new mongoose.Types.ObjectId();
    const doc = await Source.create({
      kind: SourceKind.Table,
      team: teamId,
      catalog: 's3tablescatalog/x',
      database: 'd',
      table: 't',
      displayName: 't',
      timestampColumn: 'event_time',
      defaultSort: 'event_time DESC',
      defaultColumns: ['a', 'b'],
    });
    expect(doc.timestampColumn).toBe('event_time');
    expect(doc.defaultSort).toBe('event_time DESC');
    expect(doc.defaultColumns).toEqual(['a', 'b']);
  });

  it('rejects legacy Log kind', async () => {
    const teamId = new mongoose.Types.ObjectId();
    await expect(
      Source.create({ kind: 'Log', team: teamId } as any),
    ).rejects.toThrow();
  });
});
