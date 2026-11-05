import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DBSearchPage } from '@/DBSearchPage';

const mockRouterPush = jest.fn();
const mockSetSearchedConfig = jest
  .fn()
  .mockResolvedValue(new URLSearchParams());
const mockCreateSavedSearch = jest.fn();

let mockSearchedConfig: Record<string, any> = {};
let mockSources: any[] = [];

jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

jest.mock('next/router', () => ({
  __esModule: true,
  default: {
    basePath: '/clickstack',
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
      case 'isLive':
        return [true, jest.fn()];
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
  useSources: () => ({ data: mockSources }),
  useSource: ({ id }: { id?: string | null }) => ({
    data: mockSources.find(source => source.id === id),
    isLoading: false,
  }),
}));

jest.mock('@/timeQuery', () => ({
  parseRelativeTimeQuery: () => [new Date(0), new Date(1)],
  parseTimeQuery: () => [new Date(0), new Date(1)],
  useDefaultTimeRange: () => [new Date(0), new Date(1)],
  useNewTimeQuery: () => ({
    isReady: true,
    searchedTimeRange: [
      new Date('2024-04-01T00:00:00.000Z'),
      new Date('2024-04-02T00:00:00.000Z'),
    ],
    onSearch: jest.fn(),
    onTimeRangeSelect: jest.fn(),
  }),
}));

jest.mock('@/savedSearch', () => ({
  useCreateSavedSearch: () => ({
    mutateAsync: (...args: unknown[]) => mockCreateSavedSearch(...args),
    isPending: false,
  }),
  useDeleteSavedSearch: () => ({ mutate: jest.fn() }),
  useSavedSearch: () => ({ data: undefined }),
  useUpdateSavedSearch: () => ({ mutate: jest.fn(), isPending: false }),
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

jest.mock('@/brand', () => ({
  useBrandDisplayName: () => 'ClickStack',
  usePageTitle: (page?: string) =>
    page ? `${page} - ClickStack` : 'ClickStack',
}));

jest.mock('../hooks/useMetadata', () => ({
  ...jest.requireActual('../hooks/useMetadata'),
  useTableMetadata: () => ({
    data: { sorting_key: 'Timestamp' },
    isLoading: false,
  }),
  useColumns: () => ({ data: undefined, isLoading: false }),
}));

jest.mock('../hooks/useSqlSuggestions', () => ({
  useSqlSuggestions: () => [],
}));

jest.mock('../components/Search/DirectTraceSidePanel', () => ({
  __esModule: true,
  default: () => <div />,
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
jest.mock('@/components/OnboardingModal', () => () => <div />);
jest.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => <div />,
  getStoredLanguage: () => 'lucene',
}));
jest.mock('@/components/SearchGroupBy/SearchGroupBySelect', () => ({
  SearchGroupBySelect: () => <div />,
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
jest.mock('../components/SourceSchemaPreview', () => ({
  __esModule: true,
  default: () => <div />,
  isSourceSchemaPreviewEnabled: () => false,
  getSourceSchemaTables: () => [],
}));
jest.mock('../components/Error/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../utils/queryParsers', () => ({
  parseAsJsonEncoded: () => 'parseAsJsonEncoded',
  parseAsSortingStateString: { parse: () => null },
  parseAsStringEncoded: 'parseAsStringEncoded',
}));

jest.mock('../api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({ data: { team: {} }, isSuccess: true }),
  },
  useCompleteOnboardingTask: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/utils', () => ({
  QUERY_LOCAL_STORAGE: 'query-local-storage',
  useLocalStorage: (_key: string, initialValue: unknown) => [
    initialValue,
    jest.fn(),
  ],
  usePrevious: (value: unknown) => value,
  useWindowSize: () => ({ width: 1200, height: 800 }),
}));

jest.mock('@tanstack/react-query', () => ({
  useIsFetching: () => 0,
}));

describe('DBSearchPage save search flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSavedSearch.mockResolvedValue({ id: 'new-saved-search' });
    mockSearchedConfig = {
      source: 'log-source',
      where: 'level:error',
      select: 'Timestamp, Body',
      whereLanguage: 'lucene',
      filters: [],
      orderBy: 'Timestamp DESC',
    };
    mockSources = [
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
    window.history.pushState({}, '', '/search?from=100&to=200&isLive=false');
  });

  async function saveSearchAs(name: string) {
    const user = userEvent.setup();
    render(<DBSearchPage />, {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    await user.click(await screen.findByTestId('save-search-button'));
    await user.type(await screen.findByTestId('save-search-name-input'), name);
    await user.click(screen.getByTestId('save-search-submit-button'));
  }

  // The route is pushed through the router rather than assigned to
  // window.location: a document navigation reloads the whole app, and 404s on
  // the static ClickStack export, where /search/<id> has no exported document.
  // basePath is left off because the router prepends it.
  it('navigates to the new saved search client-side', async () => {
    await saveSearchAs('Errors');

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        '/search/new-saved-search?from=100&to=200&isLive=false',
      );
    });
  });

  it('drains queued query-string updates before navigating', async () => {
    await saveSearchAs('Errors');

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    // nuqs flushes its queue onto whatever path the router reports, so a write
    // still queued when the transition starts would land back on /search.
    expect(mockSetSearchedConfig).toHaveBeenCalledWith({});
    expect(mockSetSearchedConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockRouterPush.mock.invocationCallOrder[0],
    );
  });
});
