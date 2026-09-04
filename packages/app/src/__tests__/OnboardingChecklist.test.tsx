import { ONBOARDING_TASK_IDS } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import api from '@/api';
import { useConnections } from '@/connection';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import OnboardingChecklist from '@/OnboardingChecklist';
import { useSources } from '@/source';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
    useDismissOnboarding: jest.fn(),
  },
}));
jest.mock('@/connection', () => ({ useConnections: jest.fn() }));
jest.mock('@/source', () => ({ useSources: jest.fn() }));
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

const mockUseMe = jest.mocked(api.useMe);
const mockUseDismiss = jest.mocked(api.useDismissOnboarding);
const mockUseConnections = jest.mocked(useConnections);
const mockUseSources = jest.mocked(useSources);
const mockUseQueriedChartConfig = jest.mocked(useQueriedChartConfig);

const dismissMutate = jest.fn();

function setMe(
  onboardingData: { completedTasks: string[]; isDismissed: boolean } | null,
) {
  mockUseMe.mockReturnValue({
    data:
      onboardingData === null
        ? null
        : {
            id: 'u1',
            email: 'a@b.com',
            accessKey: 'k',
            name: 'User',
            createdAt: '',
            onboardingData,
          },
    isLoading: false,
  } as unknown as ReturnType<typeof api.useMe>);
}

// setupComplete=false -> no connections/sources/data (setup phase visible).
// loading=true -> the setup queries report isLoading (data still undefined),
// mirroring the real async load where completion isn't yet knowable.
function setSetup(complete: boolean, loading = false) {
  const conn = complete ? [{ id: 'c1' }] : [];
  const src = complete
    ? [
        {
          id: 's1',
          connection: 'c1',
          from: { databaseName: 'd', tableName: 't' },
        },
      ]
    : [];
  mockUseConnections.mockReturnValue({
    data: loading ? undefined : conn,
    isLoading: loading,
  } as unknown as ReturnType<typeof useConnections>);
  mockUseSources.mockReturnValue({
    data: loading ? undefined : src,
    isLoading: loading,
  } as unknown as ReturnType<typeof useSources>);
  mockUseQueriedChartConfig.mockReturnValue({
    data: loading ? undefined : { data: [{ total_rows: complete ? 10 : 0 }] },
    isLoading: loading,
  } as unknown as ReturnType<typeof useQueriedChartConfig>);
}

function renderChecklist() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <OnboardingChecklist />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDismiss.mockReturnValue({
      mutate: dismissMutate,
      isPending: false,
    } as unknown as ReturnType<typeof api.useDismissOnboarding>);
  });

  it('renders the setup phase before setup is complete', () => {
    setMe({ completedTasks: [], isDismissed: false });
    setSetup(false);

    renderChecklist();

    expect(screen.getByText('Set up ClickHouse')).toBeInTheDocument();
    expect(screen.getByText('Connect to ClickHouse')).toBeInTheDocument();
    // Product-phase tasks are not shown yet.
    expect(screen.queryByText('Build a dashboard')).not.toBeInTheDocument();
  });

  it('renders the product phase once setup is complete and reflects completed tasks', () => {
    setMe({ completedTasks: ['dashboard'], isDismissed: false });
    setSetup(true);

    renderChecklist();

    expect(screen.getByText('Get started with HyperDX')).toBeInTheDocument();
    expect(screen.getByText('Build a dashboard')).toBeInTheDocument();
    expect(screen.getByText('Explore your data')).toBeInTheDocument();
    // 1 of 4 product tasks complete.
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  it('surfaces a task description on hover for a non-completed task', async () => {
    setMe({ completedTasks: [], isDismissed: false });
    setSetup(true);

    renderChecklist();

    // The row shows only the title; hovering reveals the "what to do"
    // description via tooltip (it's no longer rendered inline).
    expect(screen.queryByText('Add a chart tile to a dashboard')).toBeNull();
    await userEvent.hover(screen.getByText('Build a dashboard'));
    expect(
      await screen.findByText('Add a chart tile to a dashboard'),
    ).toBeInTheDocument();
  });

  it('is hidden when dismissed', () => {
    setMe({ completedTasks: [], isDismissed: true });
    setSetup(true);

    renderChecklist();

    expect(
      screen.queryByText('Get started with HyperDX'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Set up ClickHouse')).not.toBeInTheDocument();
  });

  it('hides immediately (no celebration) when already complete on load', () => {
    // Completion from a past session is derived, not a persisted flag: the card
    // just doesn't render. No dismiss is written.
    setMe({
      completedTasks: ['advancedQuery', 'dashboard', 'alert', 'mcp'],
      isDismissed: false,
    });
    setSetup(true);

    renderChecklist();

    expect(
      screen.queryByText('Get started with HyperDX'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/You're all set/)).not.toBeInTheDocument();
    expect(dismissMutate).not.toHaveBeenCalled();
  });

  it('does not celebrate on load when completion resolves after mount (async load)', () => {
    jest.useFakeTimers();
    try {
      // Mount while the setup queries are still loading, even though the user is
      // already fully complete. Nothing should render yet.
      setMe({
        completedTasks: ['advancedQuery', 'dashboard', 'alert', 'mcp'],
        isDismissed: false,
      });
      setSetup(true, /* loading */ true);
      const { rerender } = renderChecklist();
      expect(
        screen.queryByText('Get started with HyperDX'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/You're all set/)).not.toBeInTheDocument();

      // Queries resolve -> already complete on load, so still nothing, and no
      // celebration timer is armed.
      setSetup(true, /* loading */ false);
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MantineProvider>
            <OnboardingChecklist />
          </MantineProvider>
        </QueryClientProvider>,
      );
      act(() => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.queryByText(/You're all set/)).not.toBeInTheDocument();
      expect(
        screen.queryByText('Get started with HyperDX'),
      ).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('celebrates when the last task completes in-session, then hides — without persisting dismissal', () => {
    jest.useFakeTimers();
    try {
      // Mount with one task still open.
      setMe({
        completedTasks: ['advancedQuery', 'dashboard', 'alert'],
        isDismissed: false,
      });
      setSetup(true);
      const { rerender } = renderChecklist();
      expect(screen.queryByText(/You're all set/)).not.toBeInTheDocument();

      // Finish the last task -> celebration appears.
      setMe({
        completedTasks: ['advancedQuery', 'dashboard', 'alert', 'mcp'],
        isDismissed: false,
      });
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <MantineProvider>
            <OnboardingChecklist />
          </MantineProvider>
        </QueryClientProvider>,
      );
      expect(screen.getByText(/You're all set/)).toBeInTheDocument();

      // After the delay the card hides. We do NOT persist an isDismissed flag —
      // completion is derived, so adding a task later reopens the checklist.
      act(() => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.queryByText(/You're all set/)).not.toBeInTheDocument();
      expect(dismissMutate).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reopens when a new task appears after previously being complete', () => {
    // Simulates ONBOARDING_TASK_IDS gaining a task: a user who had finished the
    // old set now has an unmet task, so the checklist shows again — because we
    // derive "done" instead of persisting it.
    setMe({
      // Every id EXCEPT one is complete (stands in for a newly-added task).
      completedTasks: ['advancedQuery', 'dashboard', 'alert'],
      isDismissed: false,
    });
    setSetup(true);

    renderChecklist();

    expect(screen.getByText('Get started with HyperDX')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
  });

  it('renders one row per ONBOARDING_TASK_IDS entry (render order covers the SSOT)', () => {
    // Guards the exhaustiveness contract: PRODUCT_TASK_ORDER is derived by
    // sorting ONBOARDING_TASK_IDS, so the count of rendered product tasks must
    // equal the SSOT size — a new id can't be silently dropped from the UI.
    setMe({ completedTasks: [], isDismissed: false });
    setSetup(true);

    renderChecklist();

    expect(
      screen.getByText(`0/${ONBOARDING_TASK_IDS.length}`),
    ).toBeInTheDocument();
  });

  it('stays hidden when the user manually dismissed it', () => {
    setMe({ completedTasks: [], isDismissed: true });
    setSetup(true);

    renderChecklist();

    expect(
      screen.queryByText('Get started with HyperDX'),
    ).not.toBeInTheDocument();
  });

  it('dismisses when the dismiss button is clicked', async () => {
    setMe({ completedTasks: [], isDismissed: false });
    setSetup(true);

    renderChecklist();

    await userEvent.click(screen.getByLabelText('Dismiss checklist'));
    expect(dismissMutate).toHaveBeenCalledWith(true);
  });
});
