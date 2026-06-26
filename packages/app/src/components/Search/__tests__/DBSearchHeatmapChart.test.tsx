import React from 'react';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import type DBDeltaChartType from '@/components/DBDeltaChart';
import { DBSearchHeatmapChart } from '@/components/Search/DBSearchHeatmapChart';

type FieldsState = {
  value: string;
  count: string;
  scaleType: string;
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
};

function freshFieldsState(): FieldsState {
  return {
    value: 'Duration',
    count: 'count()',
    scaleType: 'log',
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  };
}

// Controls the values returned by useQueryStates each render.
let mockFieldsState: FieldsState = freshFieldsState();

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
  default: jest.fn((props: { enabled?: boolean }) => (
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
type DBDeltaChartProps = React.ComponentProps<typeof DBDeltaChartType>;
const deltaChartPropsLog: DBDeltaChartProps[] = [];
jest.mock('../../DBDeltaChart', () => ({
  __esModule: true,
  default: jest.fn((props: DBDeltaChartProps) => {
    deltaChartPropsLog.push(props);
    return <div data-testid="db-delta-chart" />;
  }),
}));

// Re-import the mocked ColorLegend so we can assert that it's specifically
// the heatmap color scale being passed as legendPrefix (not any truthy node).
const { ColorLegend: MockedColorLegend } = jest.requireMock(
  '../../DBHeatmapChart',
);

// Direct type annotations (no `as unknown as` casts) so adding a
// required field to either schema fails this fixture at compile
// time rather than silently passing.
const baseSource: TTraceSource = {
  id: 'trace-source',
  kind: SourceKind.Trace,
  name: 'Trace Source',
  connection: 'conn',
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp',
  durationExpression: 'Duration',
  durationPrecision: 3,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
};

const baseChartConfig: BuilderChartConfigWithDateRange = {
  dateRange: [new Date(0), new Date(1000)],
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  select: '',
  where: '',
  whereLanguage: 'sql',
};

describe('DBSearchHeatmapChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deltaChartPropsLog.length = 0;
    mockFieldsState = freshFieldsState();
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
    // legend Flex. Truthiness alone would not catch a regression that
    // swaps ColorLegend for any other element; pin the element type.
    renderWithMantine(
      <DBSearchHeatmapChart
        chartConfig={baseChartConfig}
        source={baseSource}
        isReady={true}
      />,
    );

    const lastProps = deltaChartPropsLog[deltaChartPropsLog.length - 1];
    expect(lastProps.legendPrefix).toBeTruthy();
    expect(React.isValidElement(lastProps.legendPrefix)).toBe(true);
    expect((lastProps.legendPrefix as React.ReactElement).type).toBe(
      MockedColorLegend,
    );
  });
});
