import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import {
  durationConfig,
  ERROR_RATE_FORMAT,
  ERROR_RATE_HELPER_SERIES,
  errorConditionSql,
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

const ERROR_COND = "lower(StatusCode) = 'error'";
const DURATION_EXPR = 'Duration';
const DURATION_FORMAT: NumberFormat = { output: 'duration', factor: 1e-9 };

describe('traceRedMetrics', () => {
  describe('errorConditionSql', () => {
    it('builds a lowercased error condition from the status expression', () => {
      expect(errorConditionSql('StatusCode')).toBe(ERROR_COND);
    });
    it('returns undefined without a usable status expression', () => {
      expect(errorConditionSql(undefined)).toBeUndefined();
      expect(errorConditionSql('')).toBeUndefined();
    });
  });

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
      const result = errorsConfig(redBaseConfig(base), ERROR_COND, 'rate');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.Line);
      expect(result?.numberFormat).toBe(ERROR_RATE_FORMAT);
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
          // guards the empty-bucket 0/0 and caps at 100%
          valueExpression:
            'least(if(total_spans > 0, error_spans / total_spans, 0), 1)',
        },
      ]);
      // the two aggregated counts are the ones hidden from the chart
      expect(ERROR_RATE_HELPER_SERIES).toEqual(['total_spans', 'error_spans']);
    });

    it('volume: countIf error, rendered as bars', () => {
      const result = errorsConfig(redBaseConfig(base), ERROR_COND, 'volume');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.StackedBar);
      expect(result?.numberFormat).toBe(INTEGER_NUMBER_FORMAT);
      expect(result?.select).toEqual([
        {
          alias: 'Errors',
          aggFn: 'count',
          aggCondition: ERROR_COND,
          aggConditionLanguage: 'sql',
          valueExpression: '',
        },
      ]);
    });

    it('returns undefined when the source has no error condition', () => {
      expect(
        errorsConfig(redBaseConfig(base), undefined, 'rate'),
      ).toBeUndefined();
      expect(
        errorsConfig(redBaseConfig(base), undefined, 'volume'),
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
  });
});
