import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import {
  DURATION_SERIES_COLORS,
  durationConfig,
  ERROR_RATE_FORMAT,
  ERROR_RATE_HELPER_SERIES,
  errorsConfig,
  redBaseConfig,
  throughputConfig,
} from '@/components/Search/traceRedMetrics';
import type { NumberFormat } from '@/types';

const base: BuilderChartConfigWithDateRange = {
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
  where: "ServiceName = 'api'",
  whereLanguage: 'sql',
  filters: [],
  dateRange: [new Date(0), new Date(60_000)],
  granularity: 'auto',
  groupBy: 'StatusCode',
};

const ERROR_COND = "lower(StatusCode) IN ('error', 'status_code_error')";
const DURATION_EXPR = 'Duration';
const DURATION_FORMAT: NumberFormat = { output: 'duration', factor: 1e-9 };

describe('traceRedMetrics', () => {
  describe('redBaseConfig', () => {
    it('strips the status-code groupBy and preserves filter + time range', () => {
      const result = redBaseConfig(base);
      expect(result.groupBy).toBeUndefined();
      expect(result.where).toBe(base.where);
      expect(result.dateRange).toBe(base.dateRange);
    });
  });

  describe('throughputConfig', () => {
    it('counts spans, rendered as bars', () => {
      const result = throughputConfig(redBaseConfig(base));
      expect(result.displayType).toBe(DisplayType.StackedBar);
      expect(result.numberFormat).toBe(INTEGER_NUMBER_FORMAT);
      expect(result.select).toEqual([
        {
          alias: 'Spans',
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
      ]);
      // honors the active WHERE filter carried from the base config
      expect(result.where).toBe(base.where);
    });
  });

  describe('errorsConfig', () => {
    it('rate: count + countIf aggregated separately, divided post-aggregation (MV-friendly)', () => {
      const result = errorsConfig(redBaseConfig(base), 'StatusCode', 'rate');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.Line);
      expect(result?.numberFormat).toBe(ERROR_RATE_FORMAT);
      // rate aggregates across all statuses, so no per-status groupBy
      expect(result?.groupBy).toBeUndefined();
      expect(result?.select).toEqual([
        {
          alias: 'total_spans',
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
        {
          alias: 'error_spans',
          aggFn: 'count',
          aggCondition: ERROR_COND,
          aggConditionLanguage: 'sql',
          valueExpression: '',
        },
        {
          alias: 'Error rate',
          // guards the empty-bucket 0/0; ratio can't exceed 1 so no clamp
          valueExpression: 'if(total_spans > 0, error_spans / total_spans, 0)',
        },
      ]);
      // the two aggregated counts are the ones hidden from the chart
      expect(ERROR_RATE_HELPER_SERIES).toEqual(['total_spans', 'error_spans']);
    });

    it('volume: error spans grouped by status, filtered to the error condition, as bars', () => {
      const result = errorsConfig(redBaseConfig(base), 'StatusCode', 'volume');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.StackedBar);
      expect(result?.numberFormat).toBe(INTEGER_NUMBER_FORMAT);
      // grouped by status so a clicked bar decodes to a status filter (the
      // histogram's drill-down); restricted to errors so it stays errors-only
      expect(result?.groupBy).toBe('StatusCode');
      expect(result?.select).toEqual([
        {
          alias: 'Errors',
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
      ]);
      expect(result?.filters).toEqual([{ type: 'sql', condition: ERROR_COND }]);
    });

    it('returns undefined when the source has no usable status expression', () => {
      expect(
        errorsConfig(redBaseConfig(base), undefined, 'rate'),
      ).toBeUndefined();
      expect(
        errorsConfig(redBaseConfig(base), undefined, 'volume'),
      ).toBeUndefined();
      // blank/whitespace is treated as no status expression
      expect(
        errorsConfig(redBaseConfig(base), '   ', 'volume'),
      ).toBeUndefined();
    });
  });

  describe('durationConfig', () => {
    it('aggregates the raw duration column and passes the display format through', () => {
      const result = durationConfig(
        redBaseConfig(base),
        DURATION_EXPR,
        DURATION_FORMAT,
      );
      expect(result.displayType).toBe(DisplayType.Line);
      // no SQL-side unit conversion: the format handles the unit at display
      expect(result.numberFormat).toBe(DURATION_FORMAT);
      expect(result.select).toEqual([
        {
          alias: 'Avg',
          aggFn: 'avg',
          aggCondition: '',
          valueExpression: DURATION_EXPR,
        },
        {
          alias: 'p95',
          aggFn: 'quantile',
          level: 0.95,
          aggCondition: '',
          valueExpression: DURATION_EXPR,
        },
        {
          alias: 'p99',
          aggFn: 'quantile',
          level: 0.99,
          aggCondition: '',
          valueExpression: DURATION_EXPR,
        },
      ]);
    });

    // The color pins are resolved by result-column name, so a select alias
    // that no longer has a matching key silently falls back to the positional
    // palette. Assert the two stay in lockstep rather than trusting that both
    // sides get updated together.
    it('pins a color for exactly the series it selects', () => {
      const { select } = durationConfig(
        redBaseConfig(base),
        DURATION_EXPR,
        DURATION_FORMAT,
      );
      // durationConfig always builds a select list, never a raw SQL string
      const aliases = Array.isArray(select)
        ? select.map(s => ('alias' in s ? s.alias : undefined))
        : [];
      expect(aliases).toEqual(Object.keys(DURATION_SERIES_COLORS));
    });

    // Latency is not an error signal: red is reserved for the Errors tile, and
    // the rest of the semantic palette carries its own meaning. The positional
    // palette would hand slot 2 to chart-red, so this is the regression guard
    // for that specific hue coming back.
    it('never colors a latency series with a reserved semantic hue', () => {
      const reserved = [
        'chart-red',
        'chart-error',
        'chart-warning',
        'chart-success',
      ];
      expect(
        Object.values(DURATION_SERIES_COLORS).filter(token =>
          reserved.includes(token),
        ),
      ).toEqual([]);
    });
  });
});
