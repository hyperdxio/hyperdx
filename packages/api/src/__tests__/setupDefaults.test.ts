import { SourceKind } from '@hyperdx/common-utils/dist/types';

const configState = { IS_PROMQL_ENABLED: false };

jest.mock('@/config', () => ({
  DEFAULT_CONNECTIONS: undefined,
  DEFAULT_SOURCES: JSON.stringify([
    {
      kind: 'log',
      name: 'Logs',
      connection: 'Local ClickHouse',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: 'Timestamp, Body',
    },
    {
      kind: 'promql',
      name: 'PromQL',
      connection: 'Local ClickHouse',
      from: { databaseName: 'default', tableName: 'metrics_ts' },
      timestampValueExpression: 'timestamp',
    },
  ]),
  get IS_PROMQL_ENABLED() {
    return configState.IS_PROMQL_ENABLED;
  },
}));

jest.mock('@/controllers/team', () => ({
  getTeam: jest.fn().mockResolvedValue({ _id: 'team-1' }),
}));
jest.mock('@/controllers/connection', () => ({
  createConnection: jest.fn(),
  getConnections: jest
    .fn()
    .mockResolvedValue([
      { _id: 'conn-1', team: 'team-1', name: 'Local ClickHouse' },
    ]),
}));
jest.mock('@/controllers/sources', () => ({
  getSources: jest.fn().mockResolvedValue([]),
  createSource: jest.fn(async (_teamId: string, source: { name: string }) => ({
    _id: `${source.name}-id`,
    toObject: () => source,
  })),
  updateSource: jest.fn(),
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { createSource } from '@/controllers/sources';
import { setupTeamDefaults } from '@/setupDefaults';

const createdKinds = () =>
  jest.mocked(createSource).mock.calls.map(([, source]) => source.kind);

describe('setupTeamDefaults', () => {
  beforeEach(() => {
    jest.mocked(createSource).mockClear();
  });

  it('creates a default PromQL source when PromQL is enabled', async () => {
    configState.IS_PROMQL_ENABLED = true;

    await setupTeamDefaults('team-1');

    expect(createdKinds()).toEqual([SourceKind.Log, SourceKind.Promql]);
    expect(createSource).toHaveBeenLastCalledWith(
      'team-1',
      expect.objectContaining({
        kind: SourceKind.Promql,
        connection: 'conn-1',
        from: { databaseName: 'default', tableName: 'metrics_ts' },
      }),
    );
  });

  it('skips a default PromQL source when PromQL is disabled', async () => {
    configState.IS_PROMQL_ENABLED = false;

    await setupTeamDefaults('team-1');

    expect(createdKinds()).toEqual([SourceKind.Log]);
  });
});
