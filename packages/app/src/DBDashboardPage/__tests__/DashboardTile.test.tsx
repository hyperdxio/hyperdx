import {
  AlertState,
  DisplayType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { type Tile } from '@/dashboard';

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: jest.fn(),
  getFirstTimestampValueExpression: (s: string) => s,
}));

jest.mock('@/components/charts/ChartContainer', () => ({
  __esModule: true,
  default: ({
    title,
    toolbarItems,
    children,
  }: {
    title: React.ReactNode;
    toolbarItems?: React.ReactNode[];
    children?: React.ReactNode;
  }) => (
    <div data-testid="chart-container">
      <div data-testid="chart-container-title">{title}</div>
      <div data-testid="chart-container-toolbar">{toolbarItems}</div>
      <div data-testid="chart-container-body">{children}</div>
    </div>
  ),
}));

// Render toolbarPrefix/toolbarItems so the hover-toolbar (alert button,
// filter warning) is visible in the DOM for assertions.
jest.mock('@/components/DBNumberChart', () => ({
  __esModule: true,
  default: ({ toolbarPrefix }: { toolbarPrefix?: React.ReactNode }) => (
    <div data-testid="db-number-chart">{toolbarPrefix}</div>
  ),
}));
jest.mock('@/components/DBPieChart', () => ({
  __esModule: true,
  DBPieChart: ({ toolbarPrefix }: { toolbarPrefix?: React.ReactNode }) => (
    <div data-testid="db-pie-chart">{toolbarPrefix}</div>
  ),
}));
jest.mock('@/components/DBSqlRowTableWithSidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="db-sql-row-table" />,
}));
jest.mock('@/components/DBTableChart', () => ({
  __esModule: true,
  default: ({ toolbarPrefix }: { toolbarPrefix?: React.ReactNode }) => (
    <div data-testid="db-table-chart">{toolbarPrefix}</div>
  ),
}));
jest.mock('@/components/DBTimeChart', () => ({
  __esModule: true,
  DBTimeChart: ({ toolbarPrefix }: { toolbarPrefix?: React.ReactNode }) => (
    <div data-testid="db-time-chart">{toolbarPrefix}</div>
  ),
}));
jest.mock('@/components/FullscreenPanelModal', () => ({
  __esModule: true,
  default: ({
    opened,
    children,
  }: {
    opened: boolean;
    children: React.ReactNode;
  }) => (opened ? <div data-testid="fullscreen-modal">{children}</div> : null),
}));
jest.mock('@/HDXMarkdownChart', () => ({
  __esModule: true,
  default: () => <div data-testid="markdown-chart" />,
}));
jest.mock('@/ChartUtils', () => ({
  __esModule: true,
  buildTableRowSearchUrl: jest.fn(),
}));
jest.mock('../HeatmapTile', () => ({
  __esModule: true,
  HeatmapTile: () => <div data-testid="heatmap-tile" />,
}));

import { useSource } from '@/source';

import { DashboardTile } from '../DashboardTile';

const mockUseSource = useSource as jest.MockedFunction<typeof useSource>;

const baseSource = {
  id: 'src-1',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '',
  implicitColumnExpression: '',
} as any;

const setSource = (source: typeof baseSource | undefined, isFetched = true) => {
  mockUseSource.mockReturnValue({
    data: source,
    isFetched,
  } as any);
};

const baseProps = {
  dateRange: [new Date('2024-01-01'), new Date('2024-01-02')] as [Date, Date],
  onDuplicateClick: jest.fn(),
  onEditClick: jest.fn(),
  onDeleteClick: jest.fn(),
  granularity: undefined,
  onTimeRangeSelect: jest.fn(),
};

const makeTile = (overrides: Partial<Tile> = {}): Tile =>
  ({
    id: 'tile-1',
    x: 0,
    y: 0,
    w: 4,
    h: 4,
    config: {
      name: 'My Tile',
      source: 'src-1',
      displayType: DisplayType.Line,
      select: [],
      where: '',
      whereLanguage: 'sql',
      ...((overrides as any).config ?? {}),
    },
    ...overrides,
  }) as Tile;

const getIndicatorColor = (alertButton: HTMLElement) => {
  // The button is wrapped in a Tooltip (target span) which is wrapped in
  // Mantine's Indicator. The Indicator's outer element carries
  // --indicator-color via inline style.
  let el: HTMLElement | null = alertButton;
  while (el) {
    const value = el.style?.getPropertyValue?.('--indicator-color');
    if (value) return value;
    el = el.parentElement;
  }
  return '';
};

describe('DashboardTile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('source state messaging', () => {
    it('shows source-missing message when the source id resolves to null', () => {
      setSource(undefined, true);
      renderWithMantine(
        <DashboardTile chart={makeTile()} {...(baseProps as any)} />,
      );
      expect(
        screen.getByText(
          /The data source for this tile no longer exists\. Edit the tile to select a new source\./,
        ),
      ).toBeInTheDocument();
    });

    it('shows source-unset message when the chart has no source and requires one', () => {
      setSource(undefined, true);
      const tile = makeTile({
        config: {
          name: 'Unset',
          displayType: DisplayType.Line,
          select: [],
        } as any,
      });
      renderWithMantine(<DashboardTile chart={tile} {...(baseProps as any)} />);
      expect(
        screen.getByText(
          /The data source for this tile is not set\. Edit the tile to select a data source\./,
        ),
      ).toBeInTheDocument();
    });

    it('does not show the source-unset message for a Markdown tile (sourceless display type)', () => {
      setSource(undefined, true);
      const tile = makeTile({
        config: {
          name: 'Notes',
          displayType: DisplayType.Markdown,
          select: [],
          markdown: 'hello',
        } as any,
      });
      renderWithMantine(<DashboardTile chart={tile} {...(baseProps as any)} />);
      expect(
        screen.queryByText(
          /The data source for this tile is not set\. Edit the tile to select a data source\./,
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe('alert indicator color', () => {
    const tileWithAlert = (alert: any) =>
      makeTile({
        config: {
          name: 'Alerted',
          source: 'src-1',
          displayType: DisplayType.Line,
          select: [],
          alert,
        } as any,
      });

    it('uses transparent when no alert is configured', () => {
      setSource(baseSource);
      renderWithMantine(
        <DashboardTile chart={makeTile()} {...(baseProps as any)} />,
      );
      const btn = screen.getByTestId('tile-alerts-button-tile-1');
      expect(getIndicatorColor(btn)).toBe('transparent');
    });

    it('uses green for AlertState.OK', () => {
      setSource(baseSource);
      renderWithMantine(
        <DashboardTile
          chart={tileWithAlert({ state: AlertState.OK })}
          {...(baseProps as any)}
        />,
      );
      const btn = screen.getByTestId('tile-alerts-button-tile-1');
      expect(getIndicatorColor(btn)).toMatch(/green/);
    });

    it('uses red for AlertState.ALERT without silence', () => {
      setSource(baseSource);
      renderWithMantine(
        <DashboardTile
          chart={tileWithAlert({ state: AlertState.ALERT })}
          {...(baseProps as any)}
        />,
      );
      const btn = screen.getByTestId('tile-alerts-button-tile-1');
      expect(getIndicatorColor(btn)).toMatch(/red/);
    });

    it('uses yellow when an alert is silenced', () => {
      setSource(baseSource);
      renderWithMantine(
        <DashboardTile
          chart={tileWithAlert({
            state: AlertState.ALERT,
            silenced: { at: '2024-01-01T00:00:00Z' },
          })}
          {...(baseProps as any)}
        />,
      );
      const btn = screen.getByTestId('tile-alerts-button-tile-1');
      expect(getIndicatorColor(btn)).toMatch(/yellow/);
    });
  });

  describe('filter warning', () => {
    it('renders the warning icon when a raw SQL chart lacks the $__filters macro', () => {
      setSource(baseSource);
      const tile = makeTile({
        config: {
          configType: 'sql',
          name: 'Raw',
          source: 'src-1',
          displayType: DisplayType.Line,
          select: '',
          sqlTemplate: 'SELECT count() FROM logs',
        } as any,
      });
      const { container } = renderWithMantine(
        <DashboardTile
          chart={tile}
          {...(baseProps as any)}
          filters={[{ type: 'sql', condition: 'level = "error"' }]}
        />,
      );
      // tabler IconZoomExclamation renders an SVG with this class
      expect(
        container.querySelectorAll('.tabler-icon-zoom-exclamation').length,
      ).toBeGreaterThan(0);
    });

    it('does not render the warning icon when no filters are set', () => {
      setSource(baseSource);
      const tile = makeTile({
        config: {
          configType: 'sql',
          name: 'Raw',
          source: 'src-1',
          displayType: DisplayType.Line,
          select: '',
          sqlTemplate: 'SELECT count() FROM logs',
        } as any,
      });
      const { container } = renderWithMantine(
        <DashboardTile chart={tile} {...(baseProps as any)} />,
      );
      expect(
        container.querySelectorAll('.tabler-icon-zoom-exclamation').length,
      ).toBe(0);
    });
  });

  describe('f-hotkey fullscreen toggle', () => {
    it('opens the fullscreen modal when the fullscreen toolbar button is clicked', async () => {
      setSource(baseSource);
      const user = userEvent.setup();
      const tile = makeTile();
      renderWithMantine(<DashboardTile chart={tile} {...(baseProps as any)} />);

      // Modal is initially closed
      expect(screen.queryByTestId('fullscreen-modal')).not.toBeInTheDocument();

      // The fullscreen toolbar button and the `f` hotkey both flip the same
      // `isFullscreen` state, so exercising the button covers that surface.
      const fullscreenBtn = screen.getByTestId('tile-fullscreen-button-tile-1');
      await user.click(fullscreenBtn);

      expect(screen.getByTestId('fullscreen-modal')).toBeInTheDocument();
    });

    it('does not open the fullscreen modal when the `f` hotkey fires without hovering the tile', async () => {
      setSource(baseSource);
      const user = userEvent.setup();
      const tile = makeTile();
      renderWithMantine(<DashboardTile chart={tile} {...(baseProps as any)} />);

      await user.keyboard('f');
      expect(screen.queryByTestId('fullscreen-modal')).not.toBeInTheDocument();
    });
  });
});
