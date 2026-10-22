import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buildEventsSearchUrl } from '@/ChartUtils';

const DISMISSED_KEY = 'drilldown-metric-correlated-log-warning';
const TOAST_ID = 'no-log-source-associated';

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2026-01-01T01:00:00.000Z'),
];

const metricSource = {
  id: 'metrics',
  name: 'Metrics',
  kind: SourceKind.Metric,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    histogram: '',
    sum: '',
    summary: '',
    'exponential histogram': '',
  },
  resourceAttributesExpression: 'ResourceAttributes',
} satisfies TMetricSource;

const config = {
  displayType: DisplayType.Line,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: '' },
  select: [
    {
      aggFn: 'avg',
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: 'Value',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  filters: [],
  timestampValueExpression: 'TimeUnix',
  metricTables: metricSource.metricTables,
  dateRange,
} satisfies BuilderChartConfigWithDateRange;

const drillDown = () =>
  act(async () =>
    buildEventsSearchUrl({ source: metricSource, config, dateRange }),
  );

describe('metric drill-down warning without a correlated log source', () => {
  beforeEach(() => {
    localStorage.clear();
    notifications.clean();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warns and returns null', async () => {
    renderWithMantine(<div />);

    expect(await drillDown()).toBeNull();

    expect(
      await screen.findByText(/drill-down is unavailable/i),
    ).toBeInTheDocument();
  });

  it('persists the dismissal when the close button is clicked', async () => {
    const user = userEvent.setup();
    renderWithMantine(<div />);
    await drillDown();
    const toast = await screen.findByRole('alert');
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();

    await user.click(within(toast).getByRole('button'));

    expect(localStorage.getItem(DISMISSED_KEY)).toBe('true');
    const show = jest.spyOn(notifications, 'show');
    expect(await drillDown()).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when localStorage is unavailable', async () => {
    renderWithMantine(<div />);
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(await drillDown()).toBeNull();

    expect(
      await screen.findByText(/drill-down is unavailable/i),
    ).toBeInTheDocument();
  });

  it('does not persist when the toast closes without the close button', async () => {
    renderWithMantine(<div />);
    await drillDown();
    await screen.findByRole('alert');

    // Auto-close goes through the same hide path as notifications.hide.
    act(() => {
      notifications.hide(TOAST_ID);
    });

    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    const show = jest.spyOn(notifications, 'show');
    await drillDown();
    expect(show).toHaveBeenCalledTimes(1);
  });
});
