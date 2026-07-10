import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

// Render the dynamic() wrapper's inner component synchronously.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>) => {
    // The page passes `async () => ServicesDashboardPage`; resolve it eagerly
    // to the underlying component so it renders synchronously in jsdom.
    let Component: React.ComponentType = () => null;
    loader().then((mod: any) => {
      Component = mod?.default ?? mod;
    });
    const Wrapped = (props: any) => <Component {...props} />;
    return Wrapped;
  },
}));

jest.mock('nuqs', () => {
  const noop = () => {};
  return {
    __esModule: true,
    parseAsString: { withDefault: () => ({}) },
    parseAsStringEnum: () => ({
      withDefault: (d: unknown) => ({ defaultValue: d }),
    }),
    useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => [
      parser?.defaultValue ?? null,
      noop,
    ],
    useQueryStates: () => [{}, noop],
  };
});

// Trivial stubs for the heavy tab children — the smoke test only needs the
// page shell to mount, not the chart-heavy tabs.
jest.mock('../HttpTab', () => ({
  __esModule: true,
  default: () => <div data-testid="http-tab-mock" />,
  EndpointLatencyChart: () => null,
}));
jest.mock('../DatabaseTab', () => ({
  __esModule: true,
  default: () => <div data-testid="database-tab-mock" />,
}));
jest.mock('../ErrorsTab', () => ({
  __esModule: true,
  default: () => <div data-testid="errors-tab-mock" />,
}));

// Side panels + modal + onboarding pull in networked hooks; stub them out.
jest.mock('@/components/ServiceDashboardEndpointSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ServiceDashboardDbQuerySidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/OnboardingModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/DashboardFilters', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/DashboardFiltersModal', () => ({
  __esModule: true,
  default: () => null,
}));

// Header input controls pull in networked editors / hooks; stub them out.
jest.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => null,
  getStoredLanguage: () => 'sql',
}));
jest.mock('@/components/SourceSelect', () => ({
  __esModule: true,
  SourceSelectControlled: () => null,
}));
jest.mock('@/components/SelectControlled', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/TimePicker', () => ({
  __esModule: true,
  TimePicker: () => null,
}));

jest.mock('@/hooks/usePresetDashboardFilters', () => ({
  __esModule: true,
  default: () => ({
    filters: [],
    filterValues: {},
    setFilterValue: jest.fn(),
    filterQueries: [],
    handleSaveFilter: jest.fn(),
    handleRemoveFilter: jest.fn(),
    isFetching: false,
    isMutationPending: false,
  }),
}));

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: () => ({ data: undefined }),
  useSources: () => ({ data: [] }),
}));

jest.mock('@/serviceDashboard', () => ({
  __esModule: true,
  useServiceDashboardExpressions: () => ({ expressions: undefined }),
  getExpressions: () => ({}),
}));

jest.mock('@/timeQuery', () => ({
  __esModule: true,
  parseTimeQuery: () => [new Date(0), new Date(1)],
  useNewTimeQuery: () => ({
    searchedTimeRange: [new Date(0), new Date(1)],
    onSearch: jest.fn(),
    onTimeRangeSelect: jest.fn(),
  }),
}));

jest.mock('@/hooks/useDashboardRefresh', () => ({
  __esModule: true,
  useDashboardRefresh: () => ({
    manualRefreshCooloff: false,
    refresh: jest.fn(),
  }),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  __esModule: true,
  useQueriedChartConfig: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('@/layout', () => ({
  __esModule: true,
  withAppNav: (page: unknown) => page,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  __esModule: true,
  useBrandDisplayName: () => 'HyperDX',
}));

import ServicesDashboardPage from '@/ServicesDashboardPage';

describe('ServicesDashboardPage', () => {
  it('renders the page shell', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ServicesDashboardPage />
        </MantineProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('services-dashboard-page')).toBeInTheDocument();
  });
});
