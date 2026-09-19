import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { screen, waitFor } from '@testing-library/react';

import OnboardingModal from '@/components/OnboardingModal';

/** Only the fields the demo flow matches sources on. */
type SourceFixture = {
  id: string;
  name: string;
  kind: SourceKind;
  connection: string;
};

// Ids seen in the source list after every mutation, so a test can assert that a
// source the demo flow re-seeds is never momentarily missing from the list.
let idSnapshots: string[][] = [];
let store: SourceFixture[] = [];
let createdCount = 0;

const recordSnapshot = () => idSnapshots.push(store.map(source => source.id));

const mockCreateSource = jest.fn(async ({ source }: { source: any }) => {
  // Cloud-mode semantics: a create always mints a fresh id. Local mode reuses
  // the id of a same-named source, which would mask a delete/recreate cycle.
  const created = { ...source, id: `created-${++createdCount}` };
  store = [...store, created];
  recordSnapshot();
  return created;
});

const mockUpdateSource = jest.fn(async ({ source }: { source: any }) => {
  store = store.map(stored => (stored.id === source.id ? source : stored));
  recordSnapshot();
});

const mockDeleteSource = jest.fn(async ({ id }: { id: string }) => {
  store = store.filter(stored => stored.id !== id);
  recordSnapshot();
});

const mockCreateConnection = jest.fn(async (_vars: unknown, opts?: any) => {
  const data = { id: 'local' };
  opts?.onSuccess?.(data);
  return data;
});

jest.mock('@/config', () => ({
  IS_CLICKHOUSE_BUILD: false,
  IS_LOCAL_MODE: true,
}));

jest.mock('@mantine/notifications', () => ({
  Notifications: () => null,
  notifications: { show: jest.fn() },
}));

jest.mock('@/components/ConnectionForm', () => ({
  ConnectionForm: () => null,
}));
jest.mock('../Sources/SourceForm', () => ({ TableSourceForm: () => null }));
jest.mock('../Sources/SourcesList', () => ({ SourcesList: () => null }));

jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({ getOtelTables: jest.fn() }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));

jest.mock('@/connection', () => ({
  useConnections: () => ({ data: [] }),
  useCreateConnection: () => ({ mutateAsync: mockCreateConnection }),
}));

jest.mock('@/source', () => ({
  inferTableSourceConfig: jest.fn(),
  useSources: () => ({ data: store }),
  useCreateSource: () => ({ mutateAsync: mockCreateSource }),
  useUpdateSource: () => ({ mutateAsync: mockUpdateSource }),
  useDeleteSource: () => ({ mutateAsync: mockDeleteSource }),
}));

const makeSource = (
  id: string,
  name: string,
  kind: SourceKind,
): SourceFixture => ({ id, name, kind, connection: 'local' });

/** The set of sources a previous "Connect to demo server" left behind. */
const seededDemoSources = () => [
  makeSource('demo-logs', 'Demo Logs', SourceKind.Log),
  makeSource('demo-traces', 'Demo Traces', SourceKind.Trace),
  makeSource('demo-metrics', 'Demo Metrics', SourceKind.Metric),
  makeSource('demo-sessions', 'Demo Sessions', SourceKind.Session),
  makeSource('clickpy-traces', 'ClickPy Traces', SourceKind.Trace),
  makeSource('clickpy-sessions', 'ClickPy Sessions', SourceKind.Session),
];

async function connectToDemoServer() {
  renderWithMantine(<OnboardingModal />);
  (await screen.findByTestId('demo-server-button')).click();
  await waitFor(() => {
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Success' }),
    );
  });
}

describe('OnboardingModal demo server re-seeding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    idSnapshots = [];
    store = [];
    createdCount = 0;
  });

  it('keeps every re-seeded source continuously in the list', async () => {
    store = seededDemoSources();
    const idsBefore = store.map(source => source.id);

    await connectToDemoServer();

    // Deleting the demo sources up front left `?source=<id>` pointing at
    // nothing for as long as it took to recreate them, which is what surfaced
    // the spurious "Source not found" toast on the play.hyperdx.io demo.
    for (const snapshot of idSnapshots) {
      expect(snapshot).toEqual(expect.arrayContaining(idsBefore));
    }
    expect(store.map(source => source.id).sort()).toEqual(
      [...idsBefore].sort(),
    );
    expect(mockDeleteSource).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  it('seeds the sources from scratch for a first-time visitor', async () => {
    await connectToDemoServer();

    expect(store.map(source => source.name).sort()).toEqual([
      'ClickPy Sessions',
      'ClickPy Traces',
      'Demo Logs',
      'Demo Metrics',
      'Demo Sessions',
      'Demo Traces',
    ]);
    expect(mockDeleteSource).not.toHaveBeenCalled();
  });

  it('prunes a leftover demo source only after the current set is in place', async () => {
    store = [
      ...seededDemoSources(),
      makeSource('stale-demo-logs', 'Demo Logs (old)', SourceKind.Log),
    ];
    const liveIds = seededDemoSources().map(source => source.id);

    await connectToDemoServer();

    expect(mockDeleteSource).toHaveBeenCalledWith({ id: 'stale-demo-logs' });
    expect(store.map(source => source.id)).not.toContain('stale-demo-logs');
    // The stale source goes, but never at the cost of the live ones blinking
    // out of the list first.
    for (const snapshot of idSnapshots) {
      expect(snapshot).toEqual(expect.arrayContaining(liveIds));
    }
  });
});
