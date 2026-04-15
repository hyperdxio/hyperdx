import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';

import { DBSearchPage } from '../DBSearchPage';

const mockRouterPush = jest.fn();
const mockSetSearchedConfig = jest.fn();
const mockSetDirectTraceId = jest.fn();
const mockSetAnalysisMode = jest.fn();
const mockSetIsLive = jest.fn();
const mockOnSearch = jest.fn();
const mockOnTimeRangeSelect = jest.fn();

let mockDirectTraceId: string | null = null;
let mockSearchedConfig: Record<string, any> = {};
let mockSources: any[] = [];
let latestDirectTracePanelProps: Record<string, any> | null = null;

jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

jest.mock('next/router', () => ({
  __esModule: true,
  default: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

jest.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

jest.mock('nuqs', () => ({
  parseAsBoolean: {
    withDefault: () => 'parseAsBoolean',
  },
  parseAsInteger: {
    withDefault: () => 'parseAsInteger',
  },
  parseAsString: 'parseAsString',
  parseAsStringEnum: () => ({
    withDefault: () => 'parseAsStringEnum',
  }),
  useQueryState: (key: string) => {
    switch (key) {
      case 'traceId':
        return [mockDirectTraceId, mockSetDirectTraceId];
      case 'mode':
        return ['results', mockSetAnalysisMode];
      case 'isLive':
        return [true, mockSetIsLive];
      case 'denoise':
        return [false, jest.fn()];
      default:
        return [null, jest.fn()];
    }
  },
  useQueryStates: () => [mockSearchedConfig, mockSetSearchedConfig],
}));

jest.mock('@/source', () => ({
  getEventBody: () => 'Body',
  getFirstTimestampValueExpression: () => 'Timestamp',
  useSources: () => ({
    data: mockSources,
  }),
  useSource: ({ id }: { id?: string | null }) => ({
    data: mockSources.find(source => source.id === id),
    isLoading: false,
  }),
}));

jest.mock('@/timeQuery', () => ({
  parseRelativeTimeQuery: () => [new Date(0), new Date(1)],
  parseTimeQuery: () => [new Date(0), new Date(1)],
  useNewTimeQuery: () => ({
    isReady: true,
    searchedTimeRange: [
      new Date('2024-04-01T00:00:00.000Z'),
      new Date('2024-04-02T00:00:00.000Z'),
    ],
    onSearch: mockOnSearch,
    onTimeRangeSelect: mockOnTimeRangeSelect,
  }),
}));

jest.mock('@/savedSearch', () => ({
  useCreateSavedSearch: () => ({ mutate: jest.fn() }),
  useDeleteSavedSearch: () => ({ mutate: jest.fn() }),
  useSavedSearch: () => ({ data: undefined }),
  useUpdateSavedSearch: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/searchFilters', () => ({
  useSearchPageFilterState: () => ({
    filters: [],
    whereSuggestions: [],
    setFilterValue: jest.fn(),
    clearAllFilters: jest.fn(),
  }),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  useAliasMapFromChartConfig: () => ({ data: {} }),
}));

jest.mock('@/hooks/useExplainQuery', () => ({
  useExplainQuery: () => ({}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useAppTheme: () => ({ themeName: 'hyperdx' }),
  useBrandDisplayName: () => 'HyperDX',
}));

jest.mock('../hooks/useMetadata', () => ({
  useTableMetadata: () => ({
    data: { sorting_key: 'Timestamp' },
    isLoading: false,
  }),
}));

jest.mock('../hooks/useSqlSuggestions', () => ({
  useSqlSuggestions: () => [],
}));

jest.mock('../components/Search/DirectTraceSidePanel', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    latestDirectTracePanelProps = props;
    return (
      <div data-testid="direct-trace-panel">
        <button onClick={() => props.onClose()}>close-trace</button>
        <button onClick={() => props.onSourceChange('trace-source')}>
          select-trace-source
        </button>
      </div>
    );
  },
}));

jest.mock('@/components/DBSearchPageFilters', () => ({
  DBSearchPageFilters: () => <div />,
}));

jest.mock('@/components/DBTimeChart', () => ({
  DBTimeChart: () => <div />,
}));

jest.mock('@/components/ActiveFilterPills', () => ({
  ActiveFilterPills: () => <div />,
}));
jest.mock('@/components/ContactSupportText', () => ({
  ContactSupportText: () => <div />,
}));
jest.mock('@/components/FavoriteButton', () => ({
  FavoriteButton: () => <div />,
}));
jest.mock('@/components/InputControlled', () => ({
  InputControlled: () => <div />,
}));
jest.mock('@/components/OnboardingModal', () => () => <div />);
jest.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => <div />,
  getStoredLanguage: () => 'lucene',
}));
jest.mock('@/components/SearchPageActionBar', () => () => <div />);
jest.mock('@/components/SearchTotalCountChart', () => () => <div />);
jest.mock('@/components/Sources/SourceForm', () => ({
  TableSourceForm: () => <div />,
}));
jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => <div />,
}));
jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: () => <div />,
}));
jest.mock('@/components/Tags', () => ({
  Tags: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/TimePicker', () => ({
  TimePicker: () => <div />,
}));
jest.mock('../components/ChartSQLPreview', () => ({
  SQLPreview: () => <div />,
}));
jest.mock('../components/DBSqlRowTableWithSidebar', () => () => <div />);
jest.mock('../components/PatternTable', () => () => <div />);
jest.mock('../components/Search/DBSearchHeatmapChart', () => ({
  DBSearchHeatmapChart: () => <div />,
}));
jest.mock('../components/SourceSchemaPreview', () => () => <div />);
jest.mock('../components/Error/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../utils/queryParsers', () => ({
  parseAsJsonEncoded: () => 'parseAsJsonEncoded',
  parseAsSortingStateString: {
    parse: () => null,
  },
  parseAsStringEncoded: 'parseAsStringEncoded',
}));

jest.mock('../api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({
      data: { team: {} },
      isSuccess: true,
    }),
  },
}));

jest.mock('@/utils', () => ({
  QUERY_LOCAL_STORAGE: 'query-local-storage',
  useLocalStorage: (_key: string, initialValue: unknown) => [
    initialValue,
    jest.fn(),
  ],
  usePrevious: (value: unknown) => value,
}));

jest.mock('@tanstack/react-query', () => ({
  useIsFetching: () => 0,
}));

describe('DBSearchPage direct trace flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    latestDirectTracePanelProps = null;
    mockDirectTraceId = 'trace-123';
    mockSearchedConfig = {
      source: undefined,
      where: '',
      select: '',
      whereLanguage: undefined,
      filters: [],
      orderBy: '',
    };
    mockSources = [
      {
        id: 'trace-source',
        kind: SourceKind.Trace,
        name: 'Trace Source',
        traceIdExpression: 'TraceId',
        from: { databaseName: 'db', tableName: 'traces' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp',
        implicitColumnExpression: 'Body',
        connection: 'conn',
        logSourceId: 'log-source',
      },
      {
        id: 'log-source',
        kind: SourceKind.Log,
        name: 'Log Source',
        from: { databaseName: 'db', tableName: 'logs' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp',
        implicitColumnExpression: 'Body',
        connection: 'conn',
      },
    ];
  });

  it('opens the direct trace panel with no selected source when none is provided', async () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(latestDirectTracePanelProps).toEqual(
        expect.objectContaining({
          traceId: 'trace-123',
          traceSourceId: null,
        }),
      );
    });
  });

  it('applies a direct trace filter when a valid trace source is present', async () => {
    mockSearchedConfig = {
      ...mockSearchedConfig,
      source: 'trace-source',
    };
    window.history.pushState(
      {},
      '',
      '/search?traceId=trace-123&source=trace-source',
    );

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(mockSetSearchedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'trace-source',
          where: "TraceId = 'trace-123'",
          whereLanguage: 'sql',
          filters: [],
        }),
      );
    });
  });

  it('applies the default 14-day range only when from/to are absent', () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    expect(mockOnTimeRangeSelect).toHaveBeenCalled();

    jest.clearAllMocks();
    window.history.pushState({}, '', '/search?traceId=trace-123&from=1&to=2');

    renderWithMantine(<DBSearchPage />);

    expect(mockOnTimeRangeSelect).not.toHaveBeenCalled();
  });

  it('lets the direct trace panel update the selected source', async () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(screen.getByTestId('direct-trace-panel')).toBeInTheDocument();
    });

    screen.getByText('select-trace-source').click();

    expect(mockSetSearchedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'trace-source',
        where: "TraceId = 'trace-123'",
        whereLanguage: 'sql',
        filters: [],
      }),
    );
  });

  it('clears the direct trace mode when the panel closes', async () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(screen.getByTestId('direct-trace-panel')).toBeInTheDocument();
    });

    screen.getByText('close-trace').click();

    expect(mockSetDirectTraceId).toHaveBeenCalledWith(null);
  });
});
