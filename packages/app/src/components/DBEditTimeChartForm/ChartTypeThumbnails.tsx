import { memo } from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { LineData } from '@/ChartUtils';
import { SafeAutoSizeNumber } from '@/components/charts/AutoSizeNumber';
import { BarChartView } from '@/components/charts/BarChartView';
import {
  type CategoricalChartDatum,
  PieChartView,
} from '@/components/charts/PieChartView';
import { Table } from '@/HDXMultiSeriesTableChart';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import type { NumberFormat } from '@/types';
import { formatNumber, getColorProps } from '@/utils';

import classes from './ChartTypeSelector.module.scss';

// Each chart type option draws its real chart component at thumbnail size,
// without axes, legends or tooltips. The Sample* components fill them with
// fixed data until the tile has a result to draw.

export const COMPACT_NUMBER: NumberFormat = { output: 'number', average: true };

const NO_NUMBER_FORMATS = new Map<string, NumberFormat>();
const noop = () => {};

export type TimeSeriesThumbnailProps = {
  graphResults: any[];
  lineData: LineData[];
  dateRange: [Date, Date];
  granularity: string;
  timestampKey?: string;
  displayType?: DisplayType;
};

export const TimeSeriesThumbnail = memo(function TimeSeriesThumbnail(
  props: TimeSeriesThumbnailProps,
) {
  return (
    // Keeps hovers on the real charts from drawing shadow tooltips here.
    <IsolatedChartSyncProvider>
      <MemoChart
        {...props}
        tooltipNumberFormatsByKey={NO_NUMBER_FORMATS}
        isClickActive={undefined}
        setIsClickActive={noop}
        showLegend={false}
        hideAxes
      />
    </IsolatedChartSyncProvider>
  );
});

export type TableThumbnailColumn = {
  id: string;
  dataKey: string;
  displayName: string;
  numberFormat?: NumberFormat;
};

export const TableThumbnail = memo(function TableThumbnail({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns: TableThumbnailColumn[];
}) {
  return (
    <div className={classes.scaledPreview}>
      <Table
        data={rows}
        columns={columns}
        sorting={[]}
        onSortingChange={noop}
        variant="muted"
      />
    </div>
  );
});

export const NumberThumbnail = memo(function NumberThumbnail({
  value,
}: {
  value: string;
}) {
  return <SafeAutoSizeNumber>{value}</SafeAutoSizeNumber>;
});

export const BarThumbnail = memo(function BarThumbnail({
  data,
}: {
  data: CategoricalChartDatum[];
}) {
  return <BarChartView data={data} minimal />;
});

export const PieThumbnail = memo(function PieThumbnail({
  data,
}: {
  data: CategoricalChartDatum[];
}) {
  return <PieChartView data={data} minimal />;
});

const SERVICES = [
  { name: 'frontend', count: 412_000 },
  { name: 'checkout', count: 318_000 },
  { name: 'cart', count: 254_000 },
  { name: 'payment', count: 187_000 },
  { name: 'shipping', count: 142_000 },
  { name: 'email', count: 96_000 },
];

const SAMPLE_CATEGORICAL: CategoricalChartDatum[] = SERVICES.map(
  ({ name, count }, i) => ({
    label: name,
    value: count,
    color: getColorProps(i, name),
  }),
);

const SAMPLE_START_SEC = Date.UTC(2024, 0, 1) / 1000;
const SAMPLE_VALUES = {
  frontend: [10, 16, 13, 24, 20, 30, 26, 34, 31],
  checkout: [4, 7, 6, 12, 9, 15, 13, 18, 16],
};

const SAMPLE_TIME_SERIES: TimeSeriesThumbnailProps = {
  graphResults: SAMPLE_VALUES.frontend.map((_, i) => ({
    ts_bucket: SAMPLE_START_SEC + i * 60,
    frontend: SAMPLE_VALUES.frontend[i],
    checkout: SAMPLE_VALUES.checkout[i],
  })),
  lineData: Object.keys(SAMPLE_VALUES).map((name, i) => ({
    dataKey: name,
    currentPeriodKey: name,
    previousPeriodKey: `${name} (previous)`,
    displayName: name,
    valueColumnName: 'count',
    groupValues: [name],
    color: getColorProps(i, name),
  })),
  dateRange: [
    new Date(SAMPLE_START_SEC * 1000),
    new Date((SAMPLE_START_SEC + 8 * 60) * 1000),
  ],
  granularity: '1 minute',
};

const SAMPLE_TABLE_COLUMNS: TableThumbnailColumn[] = [
  { id: 'service', dataKey: 'service', displayName: 'Service' },
  {
    id: 'count',
    dataKey: 'count',
    displayName: 'Count',
    numberFormat: COMPACT_NUMBER,
  },
];

const SAMPLE_TABLE_ROWS = SERVICES.slice(0, 3).map(({ name, count }) => ({
  service: name,
  count,
}));

export const SampleTimeSeries = () => (
  <TimeSeriesThumbnail {...SAMPLE_TIME_SERIES} />
);

export const SampleTable = () => (
  <TableThumbnail rows={SAMPLE_TABLE_ROWS} columns={SAMPLE_TABLE_COLUMNS} />
);

export const SampleNumber = () => (
  <NumberThumbnail value={formatNumber(1_420_000, COMPACT_NUMBER)} />
);

export const SampleBar = () => <BarThumbnail data={SAMPLE_CATEGORICAL} />;

export const SamplePie = () => <PieThumbnail data={SAMPLE_CATEGORICAL} />;
