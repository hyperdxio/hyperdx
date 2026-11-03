import { isBuilderSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import type {
  BuilderSavedChartConfig,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  DisplayType,
  MetricsDataType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';

import type { ChartEditorFormState } from '@/components/ChartEditor/types';
import {
  convertFormStateToChartConfig,
  convertFormStateToSavedChartConfig,
  convertSavedChartConfigToFormState,
  validateChartForm,
} from '@/components/ChartEditor/utils';

jest.mock('../../SearchInput', () => ({
  getStoredLanguage: jest.fn().mockReturnValue('lucene'),
}));

const traceSource: TSource = {
  id: 'source-trace',
  name: 'Trace Source',
  kind: SourceKind.Trace,
  connection: 'conn-1',
  from: { databaseName: 'db', tableName: 'spans' },
  timestampValueExpression: 'Timestamp',
  durationExpression: 'Duration',
  spanIdExpression: 'SpanId',
  traceIdExpression: 'TraceId',
  parentSpanIdExpression: 'ParentSpanId',
  defaultTableSelectExpression: 'SpanName',
  implicitColumnExpression: 'SpanName',
  statusCodeExpression: 'StatusCode',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  durationPrecision: 9,
};

const metricSource: TMetricSource = {
  id: 'source-metric',
  name: 'Metric Source',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'db', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: {
    gauge: 'gauge_table',
    histogram: '',
    sum: '',
    summary: '',
    'exponential histogram': '',
  },
  resourceAttributesExpression: 'ResourceAttributes',
};

const legacySelectItem = {
  aggFn: 'count' as const,
  aggCondition: '',
  aggConditionLanguage: 'lucene' as const,
  valueExpression: '(Duration)/1e6',
  countExpression: 'count()',
  heatmapScaleType: 'linear' as const,
};

// A distribution heatmap as the editor saved it before `heatmap` existed.
const legacyHeatmapTile: BuilderSavedChartConfig = {
  name: 'Latency',
  displayType: DisplayType.Heatmap,
  source: 'source-trace',
  select: [legacySelectItem],
  where: "ServiceName = 'api'",
  whereLanguage: 'sql',
  numberFormat: { output: 'duration', factor: 0.001 },
};

function roundTrip(
  config: BuilderSavedChartConfig,
  source: TSource,
): BuilderSavedChartConfig {
  const saved = convertFormStateToSavedChartConfig(
    convertSavedChartConfigToFormState(config),
    source,
  );
  if (saved == null || !isBuilderSavedChartConfig(saved)) {
    throw new Error('Expected a builder config');
  }
  return saved;
}

describe('heatmap form state conversion', () => {
  it('round-trips a tile saved before heatmap modes existed unchanged', () => {
    const saved = roundTrip(legacyHeatmapTile, traceSource);

    expect(saved).toMatchObject(legacyHeatmapTile);
    expect(saved.heatmap).toBeUndefined();
  });

  it('round-trips a distribution tile and drops its group by', () => {
    const saved = roundTrip(
      {
        ...legacyHeatmapTile,
        groupBy: 'ServiceName',
        heatmap: { mode: 'distribution' },
      },
      traceSource,
    );
    expect(saved.heatmap).toEqual({ mode: 'distribution' });
    expect(saved.groupBy).toBeUndefined();
  });

  it('round-trips a series tile', () => {
    const seriesTile: BuilderSavedChartConfig = {
      name: 'Requests',
      displayType: DisplayType.Heatmap,
      source: 'source-trace',
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Duration',
        },
      ],
      groupBy: 'ServiceName',
      where: '',
      heatmap: { mode: 'series' },
    };

    const saved = roundTrip(seriesTile, traceSource);
    expect(saved.heatmap).toEqual({ mode: 'series' });
    expect(saved.groupBy).toBe('ServiceName');
    expect(saved.select).toEqual(seriesTile.select);
  });

  it('drops the where from a series tile, which has no input for it', () => {
    const form = convertSavedChartConfigToFormState({
      ...legacyHeatmapTile,
      heatmap: { mode: 'series' },
    });

    expect(convertFormStateToSavedChartConfig(form, traceSource)).toMatchObject(
      { where: '' },
    );
    expect(
      convertFormStateToChartConfig(
        form,
        [new Date('2024-01-01'), new Date('2024-01-02')],
        traceSource,
      ),
    ).toMatchObject({ where: '' });
  });

  it('keeps the heatmap mode on the queried config', () => {
    const config = convertFormStateToChartConfig(
      convertSavedChartConfigToFormState({
        ...legacyHeatmapTile,
        heatmap: { mode: 'series' },
      }),
      [new Date('2024-01-01'), new Date('2024-01-02')],
      traceSource,
    );
    expect(config).toMatchObject({ heatmap: { mode: 'series' } });
  });

  it('drops the heatmap mode from other display types', () => {
    const saved = convertFormStateToSavedChartConfig(
      {
        ...convertSavedChartConfigToFormState({
          ...legacyHeatmapTile,
          heatmap: { mode: 'series' },
        }),
        displayType: DisplayType.Line,
      },
      traceSource,
    );
    expect(saved).toMatchObject({ heatmap: undefined });
  });
});

describe('heatmap validation', () => {
  const validate = (form: Partial<ChartEditorFormState>, source: TSource) =>
    validateChartForm(
      { series: [], ...form } as ChartEditorFormState,
      source,
      jest.fn(),
    ).map(e => e.message);

  it('requires a value expression in distribution mode', () => {
    expect(
      validate(
        {
          displayType: DisplayType.Heatmap,
          source: 'source-trace',
          series: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
        },
        traceSource,
      ),
    ).toContain('Value expression is required for heatmap charts');
  });

  it('accepts a count series without an expression in series mode', () => {
    expect(
      validate(
        {
          displayType: DisplayType.Heatmap,
          source: 'source-trace',
          heatmap: { mode: 'series' },
          series: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
        },
        traceSource,
      ),
    ).toEqual([]);
  });

  it('requires an expression for non-count series in series mode', () => {
    expect(
      validate(
        {
          displayType: DisplayType.Heatmap,
          source: 'source-trace',
          heatmap: { mode: 'series' },
          series: [{ aggFn: 'avg', aggCondition: '', valueExpression: '' }],
        },
        traceSource,
      ),
    ).toEqual(['Expression is required for series 1']);
  });

  it('requires a metric name on metric sources in series mode', () => {
    expect(
      validate(
        {
          displayType: DisplayType.Heatmap,
          source: 'source-metric',
          heatmap: { mode: 'series' },
          series: [
            {
              aggFn: 'avg',
              aggCondition: '',
              valueExpression: 'Value',
              metricType: MetricsDataType.Gauge,
            },
          ],
        },
        metricSource,
      ),
    ).toEqual(['Metric is required']);
  });
});
