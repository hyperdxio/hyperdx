import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { DBSearchHeatmapChart } from '../DBSearchHeatmapChart';

// Controls the values returned by useQueryStates each render.
let mockFieldsState: Record<string, any> = {};

jest.mock('nuqs', () => ({
  parseAsFloat: { withDefault: jest.fn(() => 'parseAsFloat') },
  parseAsString: { withDefault: jest.fn(() => 'parseAsString') },
  useQueryStates: jest.fn(() => [mockFieldsState, jest.fn()]),
}));

jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
  tcFromSource: jest.fn(() => ({})),
}));

jest.mock('@/source', () => ({
  getDurationMsExpression: jest.fn(() => 'Duration'),
}));

jest.mock('@/components/HeatmapSettingsDrawer', () =>
  jest.fn(() => <div data-testid="heatmap-settings-drawer" />),
);

jest.mock('../../DBHeatmapChart', () => ({
  __esModule: true,
  default: jest.fn((props: any) => (
    <div
      data-testid="db-heatmap-chart"
      data-enabled={String(!!props.enabled)}
    />
  )),
  ColorLegend: jest.fn(() => <div data-testid="color-legend">color scale</div>),
  darkPalette: ['#000'],
  lightPalette: ['#fff'],
  toHeatmapChartConfig: jest.fn(() => ({ heatmapConfig: {} })),
}));

// Capture props passed to DBDeltaChart so we can assert URL coords forward.
const deltaChartPropsLog: any[] = [];
jest.mock('../../DBDeltaChart', () => ({
  __esModule: true,
  default: jest.fn((props: any) => {
    deltaChartPropsLog.push(props);
    return <div data-testid="db-delta-chart" />;
  }),
}));

const baseSource: any = {
  id: 'trace-source',
  kind: SourceKind.Trace,
  name: 'Trace Source',
  durationExpression: 'Duration',
  spanIdExpression: 'SpanId',
};

const baseChartConfig: any = {
  dateRange: [new Date(0), new Date(1000)],
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  select: '',
  where: '',
};

describe('DBSearchHeatmapChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deltaChartPropsLog.length = 0;
    mockFieldsState = {
      value: 'Duration',
      count: 'count()',
      scaleType: 'log',
      xMin: null,
      xMax: null,
      yMin: null,
      yMax: null,
    };
  });

  it('renders DBDeltaChart unconditionally when no heatmap selection exists', () => {
    // Regression test for #1899: the attribute distribution chart must
    // render before any heatmap selection. A conditional wrapper here
    // gates the always-on distribution mode and ships the feature off.
    renderWithMantine(
      <DBSearchHeatmapChart
        chartConfig={baseChartConfig}
        source={baseSource}
        isReady={true}
      />,
    );

    expect(screen.getByTestId('db-delta-chart')).toBeInTheDocument();
    expect(deltaChartPropsLog.length).toBeGreaterThan(0);
    expect(deltaChartPropsLog[deltaChartPropsLog.length - 1]).toMatchObject({
      xMin: null,
      xMax: null,
      yMin: null,
      yMax: null,
      valueExpr: 'Duration',
    });
  });

  it('forwards URL selection coordinates to DBDeltaChart', () => {
    mockFieldsState = {
      ...mockFieldsState,
      xMin: 10,
      xMax: 20,
      yMin: 30,
      yMax: 40,
    };

    renderWithMantine(
      <DBSearchHeatmapChart
        chartConfig={baseChartConfig}
        source={baseSource}
        isReady={true}
      />,
    );

    expect(screen.getByTestId('db-delta-chart')).toBeInTheDocument();
    expect(deltaChartPropsLog[deltaChartPropsLog.length - 1]).toMatchObject({
      xMin: 10,
      xMax: 20,
      yMin: 30,
      yMax: 40,
    });
  });

  it('passes a ColorLegend as legendPrefix to DBDeltaChart', () => {
    // Regression test: the parent must keep passing a ColorLegend as
    // legendPrefix so the heatmap color scale appears above the
    // distribution charts. DBDeltaChart renders this prop in its
    // legend Flex.
    renderWithMantine(
      <DBSearchHeatmapChart
        chartConfig={baseChartConfig}
        source={baseSource}
        isReady={true}
      />,
    );

    const lastProps = deltaChartPropsLog[deltaChartPropsLog.length - 1];
    expect(lastProps).toHaveProperty('legendPrefix');
    expect(lastProps.legendPrefix).toBeTruthy();
  });
});
