import { Types } from 'mongoose';

import { getConnectionById } from '@/controllers/connection';
import { getSource, getSources } from '@/controllers/sources';
import { getTeam } from '@/controllers/team';
import { KnowledgeTargetError } from '@/knowledge/errors';
import { ensureKnowledgeTables } from '@/knowledge/tables';
import { resolveKnowledgeTarget } from '@/knowledge/target';

jest.mock('@/controllers/sources', () => ({
  getSource: jest.fn(),
  getSources: jest.fn(),
}));
jest.mock('@/controllers/connection', () => ({ getConnectionById: jest.fn() }));
jest.mock('@/controllers/team', () => ({ getTeam: jest.fn() }));
jest.mock('@/knowledge/tables', () => ({
  ...jest.requireActual('@/knowledge/tables'),
  ensureKnowledgeTables: jest.fn(),
}));
jest.mock('@/clickhouse', () => ({ ClickhouseClient: jest.fn() }));

const mockSources = jest.mocked(getSources);
const mockSource = jest.mocked(getSource);
const mockConnection = jest.mocked(getConnectionById);
const mockTeam = jest.mocked(getTeam);
const mockEnsure = jest.mocked(ensureKnowledgeTables);

// Partial documents: only the fields the resolver reads.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const partial = (doc: object) => doc as never;

const source = (kind: string, database = 'otel') =>
  partial({
    _id: new Types.ObjectId(),
    kind,
    connection: new Types.ObjectId(),
    from: { databaseName: database, tableName: 'otel_traces' },
  });

const teamWith = (
  knowledgeGraphTraceSource?: Types.ObjectId,
  knowledgeGraphIncludeUnconfirmed?: boolean,
) =>
  mockTeam.mockResolvedValue(
    partial({ knowledgeGraphTraceSource, knowledgeGraphIncludeUnconfirmed }),
  );

describe('resolveKnowledgeTarget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection.mockResolvedValue(
      partial({
        host: 'http://ch',
        username: 'u',
        password: 'p',
      }),
    );
    mockEnsure.mockResolvedValue(undefined);
  });

  it('uses the only trace source and returns its database', async () => {
    const trace = source('trace', 'tracedb');
    mockSources.mockResolvedValue([source('log'), trace]);
    teamWith();

    const target = await resolveKnowledgeTarget('team-1');

    expect(target.database).toBe('tracedb');
    expect(target.teamId).toBe('team-1');
    expect(target.traceSource).toBe(trace);
    expect(target.sourceId).toBe(String(Reflect.get(trace, '_id')));
    expect(target.includeUnconfirmed).toBe(false);
  });

  it('carries the team includeUnconfirmed setting', async () => {
    mockSources.mockResolvedValue([source('trace')]);
    teamWith(undefined, true);
    expect((await resolveKnowledgeTarget('team-1')).includeUnconfirmed).toBe(
      true,
    );
  });

  it('names the grants when ClickHouse denies the table DDL', async () => {
    mockSources.mockResolvedValue([source('trace', 'denied_db')]);
    teamWith();
    mockEnsure.mockRejectedValueOnce(
      Object.assign(new Error('Not enough privileges'), {
        code: '497',
        type: 'ACCESS_DENIED',
      }),
    );
    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow(
      new KnowledgeTargetError(
        'The ClickHouse user of the trace source connection cannot write the knowledge graph tables. Grant CREATE TABLE, INSERT, ALTER ADD COLUMN and ALTER DELETE on database denied_db.',
      ),
    );
  });

  it('throws when there is no trace source', async () => {
    mockSources.mockResolvedValue([source('log')]);
    teamWith();

    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow(
      new KnowledgeTargetError(
        'No trace source found. Create one before using the knowledge graph.',
      ),
    );
  });

  it('throws when there are several trace sources and none is picked', async () => {
    mockSources.mockResolvedValue([source('trace'), source('trace')]);
    teamWith();

    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow(
      new KnowledgeTargetError(
        'Several trace sources found. Pick one with PUT /api/v2/knowledge/settings.',
      ),
    );
  });

  it('uses knowledgeGraphTraceSource when set', async () => {
    const picked = source('trace', 'picked');
    const pinnedId = new Types.ObjectId();
    mockSources.mockResolvedValue([source('trace'), picked]);
    teamWith(pinnedId);
    mockSource.mockResolvedValue(picked);

    const target = await resolveKnowledgeTarget('team-1');

    expect(target.traceSource).toBe(picked);
    expect(mockSource).toHaveBeenCalledWith('team-1', pinnedId.toString());
  });

  it('throws when the pinned source is not found', async () => {
    mockSources.mockResolvedValue([source('trace')]);
    teamWith(new Types.ObjectId());
    mockSource.mockResolvedValue(null);

    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow(
      new KnowledgeTargetError(
        'The configured knowledge graph trace source was not found. Set it with PUT /api/v2/knowledge/settings.',
      ),
    );
  });

  it('throws when the pinned source is not a trace source', async () => {
    teamWith(new Types.ObjectId());
    mockSource.mockResolvedValue(source('log'));

    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow(
      new KnowledgeTargetError(
        'The configured knowledge graph trace source is not a trace source. Set it with PUT /api/v2/knowledge/settings.',
      ),
    );
  });

  it('throws when the connection is missing', async () => {
    mockSources.mockResolvedValue([source('trace')]);
    teamWith();
    mockConnection.mockResolvedValue(null);

    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow(
      new KnowledgeTargetError('The trace source connection was not found.'),
    );
  });

  it('ensures tables once per connection and database, retrying after failure', async () => {
    const trace = source('trace', 'once_db');
    mockSources.mockResolvedValue([trace]);
    teamWith();

    mockEnsure.mockRejectedValueOnce(new Error('boom'));
    await expect(resolveKnowledgeTarget('team-1')).rejects.toThrow('boom');
    await resolveKnowledgeTarget('team-1');
    await resolveKnowledgeTarget('team-1');

    expect(mockEnsure).toHaveBeenCalledTimes(2);
  });
});
