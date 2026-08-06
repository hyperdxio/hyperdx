import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from '@/ChartUtils';
import {
  durationConfig,
  errorConditionSql,
  errorsConfig,
  redBaseConfig,
  throughputConfig,
} from '@/components/Search/traceRedMetrics';

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
const DURATION_MS = '(Duration)/1e6';

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
    it('rate: avg of the error boolean, rendered as a percent line', () => {
      const result = errorsConfig(redBaseConfig(base), ERROR_COND, 'rate');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.Line);
      expect(result?.numberFormat).toBe(ERROR_RATE_PERCENTAGE_NUMBER_FORMAT);
      expect(result?.select).toEqual([
        {
          alias: 'Error rate',
          aggFn: 'avg',
          aggCondition: '',
          valueExpression: ERROR_COND,
        },
      ]);
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
    it('avg + p95 + p99 over the ms duration expression, rendered as a line', () => {
      const result = durationConfig(redBaseConfig(base), DURATION_MS);
      expect(result.displayType).toBe(DisplayType.Line);
      expect(result.numberFormat).toBe(MS_NUMBER_FORMAT);
      expect(result.select).toEqual([
        {
          alias: 'Avg',
          aggFn: 'avg',
          aggCondition: '',
          valueExpression: DURATION_MS,
        },
        {
          alias: 'p95',
          aggFn: 'quantile',
          level: 0.95,
          aggCondition: '',
          valueExpression: DURATION_MS,
        },
        {
          alias: 'p99',
          aggFn: 'quantile',
          level: 0.99,
          aggCondition: '',
          valueExpression: DURATION_MS,
        },
      ]);
    });
  });
});
