import {
  AlertSource,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { EditAlertModal } from '@/components/alerts/EditAlertModal';
import type { AlertsPageItem } from '@/types';

const updateAlertMutateAsync = jest.fn().mockResolvedValue({ data: {} });

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useUpdateAlert: () => ({
      mutateAsync: updateAlertMutateAsync,
      isPending: false,
    }),
    getAlertQueryKey: (alertId: string | undefined) => ['alert', alertId],
    getAlertsQueryKey: () => ['alerts'],
  },
}));

jest.mock('@/savedSearch', () => ({
  __esModule: true,
  useSavedSearch: () => ({
    data: { id: 'saved-search-id', source: 'source-id' },
    isLoading: false,
  }),
}));

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: () => ({ data: undefined }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  __esModule: true,
  useBrandDisplayName: () => 'HyperDX',
}));

// Heavy / visual child components are stubbed so the form still renders and
// its submit handler runs.
jest.mock('@/components/Alerts', () => ({
  __esModule: true,
  AlertChannelForm: () => <div data-testid="alert-channel-form" />,
}));
jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  __esModule: true,
  SQLInlineEditorControlled: () => <div data-testid="sql-inline-editor" />,
}));
// The threshold preview stub surfaces the live values it was rendered with so
// tests can assert the form -> preview wiring.
jest.mock('@/components/alerts/AlertDetailChart', () => ({
  __esModule: true,
  AlertDetailChart: ({
    alert,
    dateRange,
  }: {
    alert: { threshold: number };
    dateRange: [Date, Date];
  }) => (
    <div
      data-testid="alert-detail-chart"
      data-threshold={alert.threshold}
      data-date-range={dateRange.map(d => d.toISOString()).join('/')}
    />
  ),
}));

// The persisted alert shape returned by GET /alerts/:id (fields the form
// doesn't edit — name, message — must round-trip through a save).
const baseAlert = {
  _id: '6a5163af632ecadec80ec00e',
  interval: '5m',
  threshold: 3,
  thresholdType: AlertThresholdType.ABOVE,
  channel: { type: 'webhook', webhookId: 'webhook-id' },
  name: 'My alert',
  message: 'My message template',
  note: null,
  numConsecutiveWindows: null,
  scheduleStartAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  history: [],
} satisfies Partial<AlertsPageItem>;

const savedSearchAlert = {
  ...baseAlert,
  source: AlertSource.SAVED_SEARCH,
  savedSearchId: 'saved-search-id',
  groupBy: 'ServiceName',
} as AlertsPageItem;

const tileAlert = {
  ...baseAlert,
  source: AlertSource.TILE,
  dashboardId: 'dashboard-id',
  tileId: 'tile-id',
} as AlertsPageItem;

const dateRange: [Date, Date] = [
  new Date('2026-05-01T00:00:00.000Z'),
  new Date('2026-05-02T00:00:00.000Z'),
];

const renderModal = (alert: AlertsPageItem) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <EditAlertModal
        alert={alert}
        opened
        onClose={jest.fn()}
        dateRange={dateRange}
      />
    </QueryClientProvider>,
  );
};

const submitForm = async () => {
  const saveButton = await screen.findByText('Save Alert');
  fireEvent.click(saveButton.closest('button') as HTMLButtonElement);
  await waitFor(() => {
    expect(updateAlertMutateAsync).toHaveBeenCalledTimes(1);
  });
};

describe('EditAlertModal', () => {
  beforeEach(() => {
    updateAlertMutateAsync.mockClear();
  });

  it('saves a saved-search alert with the source discriminator and preserved fields', async () => {
    renderModal(savedSearchAlert);

    // Saved-search alerts expose the group-by editor.
    expect(screen.getByTestId('sql-inline-editor')).toBeInTheDocument();

    await submitForm();

    expect(updateAlertMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: savedSearchAlert._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearchId: 'saved-search-id',
        groupBy: 'ServiceName',
        threshold: 3,
        interval: '5m',
        // A legacy single-channel alert saves as the plural list.
        channels: [{ type: 'webhook', webhookId: 'webhook-id' }],
        // Fields the form doesn't edit must be carried through — the PUT
        // clears any that are omitted.
        name: 'My alert',
        message: 'My message template',
      }),
    );
  });

  it('saves a tile alert with dashboardId + tileId and no group-by editor', async () => {
    renderModal(tileAlert);

    // Tile alerts derive grouping from the chart config.
    expect(screen.queryByTestId('sql-inline-editor')).not.toBeInTheDocument();

    await submitForm();

    expect(updateAlertMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: tileAlert._id,
        source: AlertSource.TILE,
        dashboardId: 'dashboard-id',
        tileId: 'tile-id',
        name: 'My alert',
        message: 'My message template',
      }),
    );
  });

  it('updates edited threshold values in the PUT payload', async () => {
    renderModal(savedSearchAlert);

    const thresholdInput = screen.getByDisplayValue('3');
    fireEvent.change(thresholdInput, { target: { value: '42' } });

    await submitForm();

    expect(updateAlertMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 42 }),
    );
  });

  it('renders a threshold preview driven by live form values and the page time range', () => {
    renderModal(savedSearchAlert);

    const chart = screen.getByTestId('alert-detail-chart');
    expect(chart).toHaveAttribute('data-threshold', '3');
    expect(chart).toHaveAttribute(
      'data-date-range',
      '2026-05-01T00:00:00.000Z/2026-05-02T00:00:00.000Z',
    );

    // Editing the threshold updates the preview immediately (pre-save).
    const thresholdInput = screen.getByDisplayValue('3');
    fireEvent.change(thresholdInput, { target: { value: '42' } });
    expect(screen.getByTestId('alert-detail-chart')).toHaveAttribute(
      'data-threshold',
      '42',
    );
  });
});
