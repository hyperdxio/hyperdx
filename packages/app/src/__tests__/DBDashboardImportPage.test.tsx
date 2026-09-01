import {
  type DashboardTemplate,
  DashboardTemplateSchema,
  DashboardWithoutIdSchema,
} from '@hyperdx/common-utils/dist/types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { buildMappingFormSchema, Mapping } from '@/DBDashboardImportPage';

// Sources/connections the import maps the template's source *names* onto. The
// auto-mapping effect in `Mapping` matches by name (case-insensitive), so a
// template tile with `source: 'Metrics'` resolves to `src-metrics`, etc. The
// mock objects only need the fields the import path touches (id/name/kind).
const mockSources = [
  { id: 'src-metrics', name: 'Metrics', kind: 'metric' },
  { id: 'src-traces', name: 'Traces', kind: 'trace' },
  { id: 'src-logs', name: 'Logs', kind: 'log' },
];
const mockConnections = [{ id: 'conn-default', name: 'Default' }];
const mockMutateAsync = jest.fn().mockResolvedValue({ id: 'dash-new' });

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('nuqs', () => ({
  parseAsString: 'parseAsString',
  useQueryState: () => [null, jest.fn()],
}));
jest.mock('../source', () => ({
  useSources: () => ({ data: mockSources }),
}));
jest.mock('../connection', () => ({
  useConnections: () => ({ data: mockConnections }),
}));
jest.mock('../dashboard', () => ({
  useCreateDashboard: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateDashboard: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useDashboards: () => ({ data: [] }),
  normalizeRawDashboardTileColors: (x: unknown) => x,
}));
jest.mock('../api', () => ({
  __esModule: true,
  default: { useTags: () => ({ data: { data: [] } }) },
}));

// A builder tile config. Every display type that goes through the chart builder
// (everything except raw SQL) shares this shape; `select: []` is enough to
// satisfy the schema without a real query.
const builderTile = (
  id: string,
  displayType: string,
  source: string,
  y: number,
) => ({
  id,
  x: 0,
  y,
  w: 6,
  h: 3,
  config: {
    name: id,
    displayType,
    source,
    where: '',
    whereLanguage: 'sql' as const,
    select: [],
  },
});

// One tile of *every* display type plus a raw-SQL tile. The markdown tile is
// deliberately source-less (`source: ''`) — that's the case that used to throw
// `source!.id` and silently abort the whole import.
const allTileTypesTemplate: DashboardTemplate = {
  version: '0.1.0',
  name: 'All Tile Types',
  tiles: [
    {
      id: 'tile-markdown',
      x: 0,
      y: 0,
      w: 24,
      h: 1,
      config: {
        name: 'tile-markdown',
        displayType: 'markdown',
        source: '',
        where: '',
        whereLanguage: 'sql',
        select: [],
        markdown: '## Overview',
      },
    },
    builderTile('tile-number', 'number', 'Metrics', 1),
    builderTile('tile-line', 'line', 'Metrics', 4),
    builderTile('tile-stacked_bar', 'stacked_bar', 'Metrics', 7),
    builderTile('tile-table', 'table', 'Traces', 10),
    builderTile('tile-pie', 'pie', 'Metrics', 13),
    builderTile('tile-heatmap', 'heatmap', 'Traces', 16),
    builderTile('tile-search', 'search', 'Logs', 19),
    {
      id: 'tile-rawsql',
      x: 0,
      y: 22,
      w: 6,
      h: 3,
      config: {
        name: 'tile-rawsql',
        displayType: 'table',
        configType: 'sql',
        connection: 'Default',
        sqlTemplate: 'SELECT 1',
        source: 'Traces',
      },
    },
  ],
  filters: [
    {
      id: 'filter-machine',
      type: 'QUERY_EXPRESSION',
      name: 'Machine',
      expression: "ResourceAttributes['service.instance.id']",
      source: 'Metrics',
      whereLanguage: 'sql',
    },
  ],
} as DashboardTemplate;

// A template whose only filter names a source that doesn't exist in the
// workspace, so the auto-mapping effect can't resolve it and the mapping select
// stays empty.
const unresolvedFilterSourceTemplate = DashboardTemplateSchema.parse({
  version: '0.1.0',
  name: 'Unresolved Filter Source',
  tiles: [builderTile('tile-number', 'number', 'Metrics', 0)],
  filters: [
    {
      id: 'filter-machine',
      type: 'QUERY_EXPRESSION',
      name: 'Machine',
      expression: "ResourceAttributes['service.instance.id']",
      source: 'Some Source That Does Not Exist',
      whereLanguage: 'sql',
    },
  ],
});

const markdownTileWithSource = (id: string, source: string, y: number) => ({
  id,
  x: 0,
  y,
  w: 24,
  h: 1,
  config: {
    name: id,
    displayType: 'markdown',
    source,
    where: '',
    whereLanguage: 'sql' as const,
    select: [],
    markdown: '## Overview',
  },
});

// A source/connection name no mock resolves, so the auto-mapping effect leaves
// the corresponding select empty.
const MISSING = 'Does Not Exist In This Workspace';

const unresolvedTileSourceTemplate = DashboardTemplateSchema.parse({
  version: '0.1.0',
  name: 'Unresolved Tile Source',
  tiles: [builderTile('tile-number', 'number', MISSING, 0)],
});

const unresolvedConnectionTemplate = DashboardTemplateSchema.parse({
  version: '0.1.0',
  name: 'Unresolved Connection',
  tiles: [
    {
      id: 'tile-rawsql',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      config: {
        name: 'tile-rawsql',
        displayType: 'table',
        configType: 'sql',
        connection: MISSING,
        sqlTemplate: 'SELECT 1',
        source: 'Traces',
      },
    },
  ],
});

// A markdown tile renders static content, so its source is not worth blocking
// the import over even when the template names one that no longer exists.
const markdownStaleSourceTemplate = DashboardTemplateSchema.parse({
  version: '0.1.0',
  name: 'Markdown With Stale Source',
  tiles: [
    markdownTileWithSource('tile-markdown', MISSING, 0),
    builderTile('tile-number', 'number', 'Metrics', 1),
  ],
});

beforeEach(() => {
  mockMutateAsync.mockClear();
});

describe('Dashboard import - all tile types', () => {
  // Guard: the fixture must itself be a valid template, otherwise a green test
  // would only prove we can import garbage. This is the same parse the import
  // page's file dropzone runs.
  it('fixture covers every display type and is a valid template', () => {
    const parsed = DashboardTemplateSchema.safeParse(allTileTypesTemplate);
    expect(parsed.success).toBe(true);

    const displayTypes = new Set(
      allTileTypesTemplate.tiles.map(t => (t.config as any).displayType),
    );
    // markdown, number, line, stacked_bar, table, pie, heatmap, search
    expect(displayTypes.size).toBe(8);
  });

  it('imports a dashboard with every tile type into a valid payload', async () => {
    renderWithMantine(<Mapping input={allTileTypesTemplate} />);

    // The auto-mapping effect resolves source/connection names to ids on mount.
    // Wait for it to settle, then submit.
    const finish = await screen.findByRole('button', {
      name: /finish import/i,
    });
    await act(async () => {
      fireEvent.click(finish);
    });

    // The whole point: import must not silently abort. Before the markdown fix
    // the source-less tile threw and `mutateAsync` was never called.
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));

    const payload = mockMutateAsync.mock.calls[0][0];

    // The server validates create requests with this exact schema.
    const result = DashboardWithoutIdSchema.safeParse(payload);
    expect(result.success).toBe(true);

    // Every input tile survived the import (none dropped), and source names were
    // rewritten to the mapped source ids.
    expect(payload.tiles).toHaveLength(allTileTypesTemplate.tiles.length);

    const markdownTile = payload.tiles.find(
      (t: any) => t.config.displayType === 'markdown',
    );
    // Markdown stays source-less rather than being assigned a bogus source.
    expect(markdownTile.config.source ?? '').toBe('');

    const numberTile = payload.tiles.find(
      (t: any) => t.config.displayType === 'number',
    );
    expect(numberTile.config.source).toBe('src-metrics');

    const rawSqlTile = payload.tiles.find(
      (t: any) => t.config.configType === 'sql',
    );
    expect(rawSqlTile.config.connection).toBe('conn-default');

    // The filter's source name resolved to its id too.
    expect(payload.filters[0].source).toBe('src-metrics');
  });
});

describe('Dashboard import - queried filter source is required', () => {
  it('blocks the import and flags the filter row when its source is unmapped', async () => {
    renderWithMantine(<Mapping input={unresolvedFilterSourceTemplate} />);

    const finish = await screen.findByRole('button', {
      name: /finish import/i,
    });
    await act(async () => {
      fireEvent.click(finish);
    });

    await waitFor(() =>
      expect(
        screen.getByText('Select a source for this filter'),
      ).toBeInTheDocument(),
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});

describe('Dashboard import - tile mappings are required', () => {
  it('blocks the import and flags the tile row when its source is unmapped', async () => {
    renderWithMantine(<Mapping input={unresolvedTileSourceTemplate} />);

    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: /finish import/i }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText('Select a source for this tile'),
      ).toBeInTheDocument(),
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks the import and flags the connection row when a raw SQL connection is unmapped', async () => {
    renderWithMantine(<Mapping input={unresolvedConnectionTemplate} />);

    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: /finish import/i }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText('Select a connection for this tile'),
      ).toBeInTheDocument(),
    );
    // The tile's own source resolved, so only the connection is flagged.
    expect(
      screen.queryByText('Select a source for this tile'),
    ).not.toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('imports a markdown tile whose declared source no longer exists', async () => {
    renderWithMantine(<Mapping input={markdownStaleSourceTemplate} />);

    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: /finish import/i }),
      );
    });

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('Select a source for this tile'),
    ).not.toBeInTheDocument();
  });
});

describe('Dashboard import - cleared mapping selects', () => {
  // Mantine's Select writes `null` into the field when a selection is cleared.
  it('treats a cleared markdown tile source as unpicked', () => {
    const result = buildMappingFormSchema(
      markdownStaleSourceTemplate,
    ).safeParse({
      dashboardName: 'Markdown With Stale Source',
      tags: [],
      tileSourceMappings: [null, 'src-metrics'],
      connectionMappings: ['', ''],
    });

    expect(result.success).toBe(true);
    expect(result.data?.tileSourceMappings[0]).toBe('');
  });

  it('reports a cleared required tile source in the row instead of a type error', () => {
    const result = buildMappingFormSchema(
      unresolvedTileSourceTemplate,
    ).safeParse({
      dashboardName: 'Unresolved Tile Source',
      tags: [],
      tileSourceMappings: [null],
      connectionMappings: [''],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(issue => [issue.path.join('.'), issue.message]),
    ).toEqual([['tileSourceMappings.0', 'Select a source for this tile']]);
  });
});
