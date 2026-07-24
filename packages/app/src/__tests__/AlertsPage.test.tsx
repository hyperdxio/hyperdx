import React from 'react';
import {
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AlertsPage from '@/AlertsPage';
import api from '@/api';
import type { AlertsPageItem } from '@/types';
import { truncateMiddle } from '@/utils';

const mockSilenceAlert = jest.fn();
const mockUnsilenceAlert = jest.fn();
const mockSilenceAlertGroup = jest.fn();
const mockUnsilenceAlertGroup = jest.fn();
const mockResumeAlertGroup = jest.fn();
const mockClearAlertGroupResume = jest.fn();
const mutationOptionsMatcher = expect.objectContaining({
  onError: expect.any(Function),
  onSuccess: expect.any(Function),
});

jest.mock('nuqs', () => ({
  useQueryState: () => React.useState<string | null>(null),
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    getAlertsQueryKey: () => ['alerts'],
    getAlertQueryKey: (alertId: string | undefined) => ['alert', alertId],
    useAlerts: jest.fn(),
    useSilenceAlert: () => ({
      isPending: false,
      mutate: mockSilenceAlert,
    }),
    useUnsilenceAlert: () => ({
      isPending: false,
      mutate: mockUnsilenceAlert,
    }),
    useSilenceAlertGroup: () => ({
      isPending: false,
      mutate: mockSilenceAlertGroup,
    }),
    useUnsilenceAlertGroup: () => ({
      isPending: false,
      mutate: mockUnsilenceAlertGroup,
    }),
    useResumeAlertGroup: () => ({
      isPending: false,
      mutate: mockResumeAlertGroup,
    }),
    useClearAlertGroupResume: () => ({
      isPending: false,
      mutate: mockClearAlertGroupResume,
    }),
  },
}));

function renderAlertsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <AlertsPage />
    </QueryClientProvider>,
  );
}

const alertHistory = {
  counts: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  lastValues: [{ startTime: '2024-01-01T00:00:00.000Z', count: 1 }],
  state: AlertState.ALERT,
};

function makeAlert(overrides: Partial<AlertsPageItem> = {}): AlertsPageItem {
  return {
    _id: 'alert-1',
    interval: '5m',
    threshold: 10,
    thresholdType: AlertThresholdType.ABOVE,
    channel: { type: 'webhook' },
    state: AlertState.ALERT,
    source: AlertSource.SAVED_SEARCH,
    savedSearchId: 'saved-search-1',
    name: null,
    message: null,
    note: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    history: [alertHistory],
    groupBy: 'ServiceName',
    savedSearch: {
      _id: 'saved-search-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      name: 'Grouped alert',
      updatedAt: '2024-01-01T00:00:00.000Z',
      tags: [],
    },
    ...overrides,
  };
}

describe('AlertsPage grouped alerts', () => {
  beforeEach(() => {
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.ALERT,
                history: [alertHistory],
              },
              {
                group: 'ServiceName:api',
                state: AlertState.OK,
                history: [{ ...alertHistory, state: AlertState.OK }],
                silenced: {
                  by: 'test@example.com',
                  at: '2024-01-01T00:00:00.000Z',
                  until: '2099-01-01T00:00:00.000Z',
                },
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);
    mockSilenceAlert.mockClear();
    mockUnsilenceAlert.mockClear();
    mockSilenceAlertGroup.mockClear();
    mockUnsilenceAlertGroup.mockClear();
    mockResumeAlertGroup.mockClear();
    mockClearAlertGroupResume.mockClear();
  });

  it('renders group rows in their matching status sections', () => {
    renderAlertsPage();

    expect(
      screen.getByTestId('alert-group-row-alert-1-ALERT-0'),
    ).toHaveTextContent('ServiceName:app');
    expect(
      screen.getByTestId('alert-group-row-alert-1-OK-0'),
    ).toHaveTextContent('ServiceName:api');
  });

  it('renders OK group rows for an OK alert', () => {
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            state: AlertState.OK,
            history: [{ ...alertHistory, state: AlertState.OK }],
            groups: [
              {
                group: 'ServiceName:api',
                state: AlertState.OK,
                history: [{ ...alertHistory, state: AlertState.OK }],
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    expect(
      screen.getByTestId('alert-group-row-alert-1-OK-0'),
    ).toHaveTextContent('ServiceName:api');
  });

  it('collapses and expands group rows under a grouped alert', async () => {
    const user = userEvent.setup();
    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    const toggle = screen.getByTestId('alert-group-toggle-alert-1-ALERT');

    expect(groupRow).toBeVisible();

    await user.click(toggle);
    expect(groupRow).not.toBeVisible();

    await user.click(toggle);
    expect(groupRow).toBeVisible();
  });

  it('shows grouped configuration without child rows before group history exists', () => {
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            groups: [],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    expect(
      screen.queryByTestId('alert-group-toggle-alert-1-ALERT'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Grouped by ServiceName')).toBeInTheDocument();
    expect(
      screen.queryByText('Waiting for group data'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId(/alert-group-row-/)).not.toBeInTheDocument();
  });

  it('does not show an empty collapse when a grouped alert has no groups in that status section', () => {
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            state: AlertState.ALERT,
            groups: [
              {
                group: 'ServiceName:api',
                state: AlertState.OK,
                history: [{ ...alertHistory, state: AlertState.OK }],
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    expect(
      screen.queryByTestId('alert-group-toggle-alert-1-ALERT'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('alert-group-toggle-alert-1-OK'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('alert-group-row-alert-1-OK-0'),
    ).toHaveTextContent('ServiceName:api');
  });

  it('renders ungrouped alerts without group rows even when stale group summaries exist', () => {
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            groupBy: undefined,
            groups: [
              {
                group: 'ServiceName:api',
                state: AlertState.ALERT,
                history: [alertHistory],
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    expect(
      screen.queryByTestId('alert-group-toggle-alert-1-ALERT'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('ServiceName:api')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Waiting for group data'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Grouped by ServiceName'),
    ).not.toBeInTheDocument();
  });

  it('acking a group calls the group-specific mutation payload', async () => {
    const user = userEvent.setup();
    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    await user.click(within(groupRow).getByRole('button', { name: 'Ack' }));
    await user.click(await screen.findByText('30 minutes'));

    expect(mockSilenceAlertGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: 'alert-1',
        group: 'ServiceName:app',
        mutedUntil: expect.any(String),
      }),
      mutationOptionsMatcher,
    );
    expect(mockSilenceAlert).not.toHaveBeenCalled();
  });

  it('normalizes legacy dashboard alert group labels for display while preserving ack payload', async () => {
    const user = userEvent.setup();
    const rawGroup =
      'arrayElement(ResourceAttributes, \'process.command_args\'):["node","./src/index.ts"]';
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            groups: [
              {
                group: rawGroup,
                state: AlertState.ALERT,
                history: [alertHistory],
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    const displayGroup =
      'ResourceAttributes[\'process.command_args\']:["node","./src/index.ts"]';

    expect(groupRow).toHaveTextContent(truncateMiddle(displayGroup, 35));
    expect(
      within(groupRow).getByTitle(rawGroup, { exact: true }),
    ).toBeInTheDocument();
    expect(groupRow).not.toHaveTextContent(
      'ResourceAttributes[\'process.command_args\']:["node","./src/index.ts"]',
    );

    await user.click(within(groupRow).getByRole('button', { name: 'Ack' }));
    await user.click(await screen.findByText('30 minutes'));

    expect(mockSilenceAlertGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: 'alert-1',
        group: rawGroup,
        mutedUntil: expect.any(String),
      }),
      mutationOptionsMatcher,
    );
  });

  it('resuming a group calls the group-specific unsilence mutation', async () => {
    const user = userEvent.setup();
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.ALERT,
                history: [alertHistory],
                silenced: {
                  by: 'test@example.com',
                  at: '2024-01-01T00:00:00.000Z',
                  until: '2099-01-01T00:00:00.000Z',
                },
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    await user.click(within(groupRow).getByRole('button', { name: "Ack'd" }));
    await user.click(await screen.findByText('Resume alert'));

    expect(mockUnsilenceAlertGroup).toHaveBeenCalledWith(
      {
        alertId: 'alert-1',
        group: 'ServiceName:app',
      },
      mutationOptionsMatcher,
    );
    expect(mockUnsilenceAlert).not.toHaveBeenCalled();
  });

  it('parent-level ack still calls the whole-alert mutation', async () => {
    const user = userEvent.setup();
    renderAlertsPage();

    const alertCard = screen.getByTestId('alert-card-alert-1-ALERT');
    await user.click(
      within(alertCard).getAllByRole('button', { name: 'Ack' })[0],
    );
    await user.click(await screen.findByText('30 minutes'));

    expect(mockSilenceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: 'alert-1',
        mutedUntil: expect.any(String),
      }),
      mutationOptionsMatcher,
    );
    expect(mockSilenceAlertGroup).not.toHaveBeenCalled();
  });

  it('shows group ack as effective for touched alerting group rows while preserving parent ack metadata', async () => {
    const user = userEvent.setup();
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            silenced: {
              by: 'parent@example.com',
              at: '2024-01-01T00:00:00.000Z',
              until: '2099-01-01T00:00:00.000Z',
            },
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.ALERT,
                history: [alertHistory],
                silenced: {
                  by: 'group@example.com',
                  at: '2024-01-02T00:00:00.000Z',
                  until: '2099-01-02T00:00:00.000Z',
                },
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    await user.click(within(groupRow).getByRole('button', { name: "Ack'd" }));

    expect(await screen.findByText('group@example.com')).toBeInTheDocument();
    expect(
      screen.getByText(/Parent alert acknowledgment also exists/),
    ).toBeInTheDocument();
    expect(screen.getByText('parent@example.com')).toBeInTheDocument();
  });

  it('shows inherited parent ack as the effective group state and can resume only that group', async () => {
    const user = userEvent.setup();
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            silenced: {
              by: 'parent@example.com',
              at: '2024-01-01T00:00:00.000Z',
              until: '2099-01-01T00:00:00.000Z',
            },
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.ALERT,
                history: [alertHistory],
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');

    await user.click(within(groupRow).getByRole('button', { name: 'Muted' }));
    expect(await screen.findByText('Muted by parent ack.')).toBeInTheDocument();
    await user.click(screen.getByText('Resume group'));

    expect(mockResumeAlertGroup).toHaveBeenCalledWith(
      {
        alertId: 'alert-1',
        group: 'ServiceName:app',
      },
      mutationOptionsMatcher,
    );
    expect(mockUnsilenceAlert).not.toHaveBeenCalled();
  });

  it('does not show parent ack as effective for OK group rows', () => {
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            state: AlertState.OK,
            history: [{ ...alertHistory, state: AlertState.OK }],
            silenced: {
              by: 'parent@example.com',
              at: '2024-01-01T00:00:00.000Z',
              until: '2099-01-01T00:00:00.000Z',
            },
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.OK,
                history: [{ ...alertHistory, state: AlertState.OK }],
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-OK-0');
    expect(
      within(groupRow).queryByRole('button', { name: 'Muted' }),
    ).not.toBeInTheDocument();
  });

  it('shows explicit group ack for OK group rows while parent ack is active', async () => {
    const user = userEvent.setup();
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            state: AlertState.OK,
            history: [{ ...alertHistory, state: AlertState.OK }],
            silenced: {
              by: 'parent@example.com',
              at: '2024-01-01T00:00:00.000Z',
              until: '2099-01-01T00:00:00.000Z',
            },
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.OK,
                history: [{ ...alertHistory, state: AlertState.OK }],
                silenced: {
                  by: 'group@example.com',
                  at: '2024-01-02T00:00:00.000Z',
                  until: '2099-01-02T00:00:00.000Z',
                },
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-OK-0');
    await user.click(within(groupRow).getByRole('button', { name: "Ack'd" }));

    expect(await screen.findByText('group@example.com')).toBeInTheDocument();
    expect(screen.queryByText('parent@example.com')).not.toBeInTheDocument();
  });

  it('resuming an explicitly acked group while parent ack is active creates a group resume override', async () => {
    const user = userEvent.setup();
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            silenced: {
              by: 'parent@example.com',
              at: '2024-01-01T00:00:00.000Z',
              until: '2099-01-01T00:00:00.000Z',
            },
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.ALERT,
                history: [alertHistory],
                silenced: {
                  by: 'group@example.com',
                  at: '2024-01-02T00:00:00.000Z',
                  until: '2099-01-02T00:00:00.000Z',
                },
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    await user.click(within(groupRow).getByRole('button', { name: "Ack'd" }));
    await user.click(await screen.findByText('Resume group'));

    expect(mockResumeAlertGroup).toHaveBeenCalledWith(
      {
        alertId: 'alert-1',
        group: 'ServiceName:app',
      },
      mutationOptionsMatcher,
    );
    expect(mockUnsilenceAlert).not.toHaveBeenCalled();
  });

  it('can return an explicitly resumed group to the parent acknowledgment', async () => {
    const user = userEvent.setup();
    const parentSilencedAt = '2024-01-01T00:00:00.000Z';
    jest.mocked(api.useAlerts).mockReturnValue({
      data: {
        data: [
          makeAlert({
            silenced: {
              by: 'parent@example.com',
              at: parentSilencedAt,
              until: '2099-01-01T00:00:00.000Z',
            },
            groups: [
              {
                group: 'ServiceName:app',
                state: AlertState.ALERT,
                history: [alertHistory],
                unsilenced: {
                  by: 'group@example.com',
                  at: '2024-01-02T00:00:00.000Z',
                  parentSilencedAt,
                },
              },
            ],
          }),
        ],
      },
      isError: false,
      isLoading: false,
    } as ReturnType<typeof api.useAlerts>);

    renderAlertsPage();

    const groupRow = screen.getByTestId('alert-group-row-alert-1-ALERT-0');
    await user.click(within(groupRow).getByRole('button', { name: 'Ack' }));
    await user.click(await screen.findByText('Use parent ack'));

    expect(mockClearAlertGroupResume).toHaveBeenCalledWith(
      {
        alertId: 'alert-1',
        group: 'ServiceName:app',
      },
      mutationOptionsMatcher,
    );
  });
});
