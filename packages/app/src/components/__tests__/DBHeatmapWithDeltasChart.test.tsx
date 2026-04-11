import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import DBHeatmapWithDeltasChart from '../DBHeatmapWithDeltasChart';

const mockDBDeltaChart = jest.fn(() => (
  <div data-testid="db-delta-chart">Delta chart</div>
));
const mockDBHeatmapChart = jest.fn(() => (
  <div data-testid="db-heatmap-chart">Heatmap chart</div>
));

jest.mock('../DBDeltaChart', () => ({
  __esModule: true,
  default: (props: unknown) => mockDBDeltaChart(props),
}));

jest.mock('../DBHeatmapChart', () => ({
  __esModule: true,
  default: (props: unknown) => mockDBHeatmapChart(props),
  ColorLegend: () => <div data-testid="color-legend" />,
  darkPalette: ['#000000'],
  lightPalette: ['#ffffff'],
}));

jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: () => (
    <div data-testid="sql-inline-editor-controlled">SQL editor</div>
  ),
}));

const baseChartConfig = {
  timestampValueExpression:
    'toStartOfInterval(toDateTime(TimestampTime), INTERVAL 1 minute) AS `__hdx_time_bucket`',
  connection: 'default',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  select: [{ aggFn: 'count' as const, valueExpression: '' }],
  where: '',
  granularity: 'auto' as const,
  dateRange: [
    new Date('2026-04-10T23:00:00Z'),
    new Date('2026-04-11T00:00:00Z'),
  ],
};

const mockTraceSource = {
  id: 'trace-source',
  kind: SourceKind.Trace,
  name: 'Demo Traces',
  connection: 'default',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'TimestampTime',
  durationExpression: 'Duration',
  durationPrecision: 9,
  spanIdExpression: 'SpanId',
} as const;

describe('DBHeatmapWithDeltasChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sanitizes timestamp expression aliases before passing config to DBDeltaChart', () => {
    renderWithMantine(
      <DBHeatmapWithDeltasChart
        chartConfig={baseChartConfig}
        source={mockTraceSource}
        isReady
        valueExpression="Duration"
        countExpression="count()"
        scaleType="log"
      />,
    );

    expect(screen.getByTestId('db-delta-chart')).toBeInTheDocument();
    expect(mockDBDeltaChart).toHaveBeenCalled();

    const firstCallProps = mockDBDeltaChart.mock.calls[0]?.[0] as {
      config?: { timestampValueExpression?: string };
    };

    expect(firstCallProps.config?.timestampValueExpression).toBe(
      'toStartOfInterval(toDateTime(TimestampTime), INTERVAL 1 minute)',
    );
  });
});
