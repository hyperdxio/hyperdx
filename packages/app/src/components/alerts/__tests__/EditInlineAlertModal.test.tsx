import {
  AlertSource,
  AlertThresholdType,
  DisplayType,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  EditInlineAlertModal,
  inlineAlertToChartConfig,
} from '@/components/alerts/EditInlineAlertModal';
import type { AlertsPageItem } from '@/types';

const updateAlertMutateAsync = jest.fn().mockResolvedValue({ data: {} });
const useAlert = jest.fn();

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useUpdateAlert: () => ({
      mutateAsync: updateAlertMutateAsync,
      isPending: false,
    }),
    useAlert: (id: string | undefined) => useAlert(id),
    getAlertQueryKey: (alertId: string | undefined) => ['alert', alertId],
    getAlertsQueryKey: () => ['alerts'],
  },
}));

jest.mock('@/useConfirm', () => ({ useConfirm: () => jest.fn() }));
jest.mock('@/theme/ThemeProvider', () => ({
  __esModule: true,
  useBrandDisplayName: () => 'HyperDX',
}));

// The chart editor has its own suite; here it is stubbed to a "save what I was
// seeded with" button, so these tests cover the modal's seeding and its PUT.
jest.mock('@/components/DBEditTimeChartForm', () => ({
  __esModule: true,
  default: ({
    chartConfig,
    onSave,
    enableAlerts,
    isAlertRequired,
    showSaveToDashboard,
  }: {
    chartConfig: SavedChartConfig;
    onSave: (config: SavedChartConfig) => void;
    enableAlerts?: boolean;
    isAlertRequired?: boolean;
    showSaveToDashboard?: boolean;
  }) => (
    <div
      data-testid="chart-editor"
      data-config={JSON.stringify(chartConfig)}
      data-enable-alerts={String(enableAlerts)}
      data-alert-required={String(isAlertRequired)}
      data-save-to-dashboard={String(showSaveToDashboard)}
    >
      <button type="button" onClick={() => onSave(chartConfig)}>
        Save
      </button>
      <button
        type="button"
        data-testid="save-without-alert"
        onClick={() => onSave({ ...chartConfig, alert: undefined })}
      >
        Save without alert
      </button>
    </div>
  ),
}));

const chartConfig = {
  name: 'Error rate',
  source: 'source-1',
  displayType: DisplayType.Line,
  select: [{ aggFn: 'count' as const, aggCondition: '', valueExpression: '' }],
  where: '',
};

// The alerts API response, as a loosely-built fixture. `value: any` (rather
// than an `as` cast) keeps this off the no-unsafe-type-assertion budget while
// still producing a value typed as AlertsPageItem.
const asAlert = (value: any): AlertsPageItem => value;

const inlineAlert = asAlert({
  _id: '6a5163af632ecadec80ec00e',
  source: AlertSource.INLINE,
  interval: '5m',
  threshold: 3,
  thresholdType: AlertThresholdType.ABOVE,
  channel: { type: 'webhook', webhookId: 'webhook-id' },
  name: 'Prod error rate',
  message: 'My message template',
  note: null,
  numConsecutiveWindows: null,
  scheduleStartAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  history: [],
  chartConfig,
});

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
      <EditInlineAlertModal
        alert={alert}
        opened
        onClose={jest.fn()}
        dateRange={dateRange}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  updateAlertMutateAsync.mockClear();
  useAlert.mockReturnValue({ data: undefined, isLoading: false });
});

describe('inlineAlertToChartConfig', () => {
  it('folds the alert fields back into the chart config the editor edits', () => {
    const config = inlineAlertToChartConfig(inlineAlert);

    expect(config).toMatchObject({
      ...chartConfig,
      alert: {
        id: inlineAlert._id,
        interval: '5m',
        threshold: 3,
        name: 'Prod error rate',
        channels: [{ type: 'webhook', webhookId: 'webhook-id' }],
      },
    });
  });

  it('has nothing to seed without a chart config', () => {
    expect(
      inlineAlertToChartConfig({
        ...inlineAlert,
        chartConfig: undefined,
      }),
    ).toBeUndefined();
  });
});

describe('EditInlineAlertModal', () => {
  it('seeds the chart editor from the alert and requires an alert', () => {
    renderModal(inlineAlert);

    const editor = screen.getByTestId('chart-editor');
    expect(JSON.parse(editor.dataset.config ?? '{}')).toMatchObject({
      name: 'Error rate',
      alert: { threshold: 3 },
    });
    expect(editor.dataset.enableAlerts).toBe('true');
    expect(editor.dataset.alertRequired).toBe('true');
    // Saving this chart as a tile would copy its alert onto the tile,
    // leaving two alerts on one query.
    expect(editor.dataset.saveToDashboard).toBe('false');
  });

  it('splits the edited config back into an inline alert payload on save', async () => {
    renderModal(inlineAlert);

    await userEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateAlertMutateAsync).toHaveBeenCalledTimes(1),
    );
    const payload = updateAlertMutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      id: inlineAlert._id,
      source: AlertSource.INLINE,
      threshold: 3,
      chartConfig: { name: 'Error rate' },
    });
    // The alert's fields live on the alert document, never inside the config
    // it evaluates.
    expect(payload.chartConfig).not.toHaveProperty('alert');
  });

  // The display type can be switched to one that drops the alert; saving then
  // would rewrite the alert with no threshold to evaluate.
  it('refuses to save a config whose alert was dropped', async () => {
    renderModal(inlineAlert);

    await userEvent.click(screen.getByTestId('save-without-alert'));

    expect(updateAlertMutateAsync).not.toHaveBeenCalled();
  });

  // The alerts list omits chartConfig, so a row-opened alert has to fetch the
  // detail response before the editor can be seeded.
  it('fetches the full alert when opened without a chart config', () => {
    useAlert.mockReturnValue({ data: undefined, isLoading: true });
    const listAlert = { ...inlineAlert, chartConfig: undefined };

    renderModal(listAlert);

    expect(useAlert).toHaveBeenCalledWith(listAlert._id);
    expect(screen.queryByTestId('chart-editor')).not.toBeInTheDocument();
  });

  it('seeds the editor from the fetched alert', () => {
    useAlert.mockReturnValue({
      data: { data: inlineAlert },
      isLoading: false,
    });

    renderModal({ ...inlineAlert, chartConfig: undefined });

    expect(
      JSON.parse(screen.getByTestId('chart-editor').dataset.config ?? '{}'),
    ).toMatchObject({ name: 'Error rate', alert: { threshold: 3 } });
  });

  // An alert already carrying its config (opened from the detail page) does
  // not re-request it.
  it('does not fetch when the alert already carries its config', () => {
    renderModal(inlineAlert);

    expect(useAlert).toHaveBeenCalledWith(undefined);
  });
});
