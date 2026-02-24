import {
  ChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import {
  convertToNumberChartConfig,
  convertToTableChartConfig,
  convertToTimeChartConfig,
  formatResponseForPieChart,
  formatResponseForTimeChart,
} from '@/ChartUtils';
import { COLORS, getChartColorError } from '@/utils';

describe('ChartUtils', () => {
  describe('formatResponseForTimeChart', () => {
    it('should throw an error if there is no timestamp column', () => {
      const res = {
        data: [
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 167783540.53459233,
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 182291463.92714182,
          },
        ],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
        ],
      };

      expect(() =>
        formatResponseForTimeChart({
          currentPeriodResponse: res,
          dateRange: [new Date(), new Date()],
          granularity: '1 minute',
          generateEmptyBuckets: false,
        }),
      ).toThrow(
        'No timestamp column found with meta: [{"name":"AVG(toFloat64OrDefault(toString(Duration)))","type":"Float64"}]',
      );
    });

    it('should return empty results for an empty response', () => {
      const res = {
        data: [],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(), new Date()],
        granularity: '1 minute',
        generateEmptyBuckets: false,
      });

      expect(actual.graphResults).toEqual([]);

      expect(actual.timestampColumn).toEqual({
        name: '__hdx_time_bucket',
        type: 'DateTime',
      });
      expect(actual.lineData).toEqual([]);
    });

    it('should format a response with a single value column and no group by', () => {
      const res = {
        data: [
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 167783540.53459233,
            __hdx_time_bucket: '2025-11-26T11:12:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 182291463.92714182,
            __hdx_time_bucket: '2025-11-26T11:13:00Z',
          },
        ],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(), new Date()],
        granularity: '1 minute',
        generateEmptyBuckets: false,
      });

      expect(actual.graphResults).toEqual([
        {
          __hdx_time_bucket: 1764155520,
          'AVG(toFloat64OrDefault(toString(Duration)))': 167783540.53459233,
        },
        {
          __hdx_time_bucket: 1764155580,
          'AVG(toFloat64OrDefault(toString(Duration)))': 182291463.92714182,
        },
      ]);

      expect(actual.timestampColumn).toEqual({
        name: '__hdx_time_bucket',
        type: 'DateTime',
      });
      expect(actual.lineData).toEqual([
        {
          color: COLORS[0],
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          currentPeriodKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration)))',
          isDashed: false,
        },
      ]);
    });

    it('should format a response with multiple value columns and a group by', () => {
      const res = {
        data: [
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 43828228.21181263,
            max: 563518061,
            ServiceName: 'checkout',
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 6759697.6283185845,
            max: 42092944,
            ServiceName: 'shipping',
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 36209980.6533264,
            max: 795111023,
            ServiceName: 'checkout',
            __hdx_time_bucket: '2025-11-26T12:24:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 6479038.598323171,
            max: 63136666,
            ServiceName: 'shipping',
            __hdx_time_bucket: '2025-11-26T12:24:00Z',
          },
        ],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
          {
            name: 'max',
            type: 'Float64',
          },
          {
            name: 'ServiceName',
            type: 'LowCardinality(String)',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(), new Date()],
        granularity: '1 minute',
        generateEmptyBuckets: false,
      });

      expect(actual.graphResults).toEqual([
        {
          __hdx_time_bucket: 1764159780,
          'AVG(toFloat64OrDefault(toString(Duration))) · checkout': 43828228.21181263,
          'AVG(toFloat64OrDefault(toString(Duration))) · shipping': 6759697.6283185845,
          'max · checkout': 563518061,
          'max · shipping': 42092944,
        },
        {
          __hdx_time_bucket: 1764159840,
          'AVG(toFloat64OrDefault(toString(Duration))) · checkout': 36209980.6533264,
          'AVG(toFloat64OrDefault(toString(Duration))) · shipping': 6479038.598323171,
          'max · checkout': 795111023,
          'max · shipping': 63136666,
        },
      ]);

      expect(actual.timestampColumn).toEqual({
        name: '__hdx_time_bucket',
        type: 'DateTime',
      });
      expect(actual.lineData).toEqual([
        {
          color: COLORS[0],
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · checkout (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          isDashed: false,
        },
        {
          color: COLORS[1],
          dataKey: 'max · checkout',
          currentPeriodKey: 'max · checkout',
          previousPeriodKey: 'max · checkout (previous)',
          displayName: 'max · checkout',
          isDashed: false,
        },
        {
          color: COLORS[2],
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · shipping (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          isDashed: false,
        },
        {
          color: COLORS[3],
          dataKey: 'max · shipping',
          currentPeriodKey: 'max · shipping',
          previousPeriodKey: 'max · shipping (previous)',
          displayName: 'max · shipping',
          isDashed: false,
        },
      ]);
    });

    it('should assign colors to log levels', () => {
      const res = {
        data: [
          {
            'count()': '1',
            SeverityText: 'info',
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'count()': '3',
            SeverityText: 'debug',
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'count()': '1',
            SeverityText: 'error',
            __hdx_time_bucket: '2025-11-26T12:24:00Z',
          },
        ],
        meta: [
          {
            name: 'count()',
            type: 'UInt64',
          },
          {
            name: 'SeverityText',
            type: 'LowCardinality(String)',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const source = {
        kind: SourceKind.Log,
        severityTextExpression: 'SeverityText',
      } as TSource;

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(), new Date()],
        granularity: '1 minute',
        generateEmptyBuckets: false,
        source,
      });

      expect(actual.lineData).toEqual([
        {
          color: COLORS[0],
          dataKey: 'info',
          currentPeriodKey: 'info',
          previousPeriodKey: 'info (previous)',
          displayName: 'info',
          isDashed: false,
        },
        {
          color: COLORS[0],
          dataKey: 'debug',
          currentPeriodKey: 'debug',
          previousPeriodKey: 'debug (previous)',
          displayName: 'debug',
          isDashed: false,
        },
        {
          color: getChartColorError(),
          dataKey: 'error',
          currentPeriodKey: 'error',
          previousPeriodKey: 'error (previous)',
          displayName: 'error',
          isDashed: false,
        },
      ]);
    });

    it('should zero-fill missing time buckets when generateEmptyBuckets is undefined', () => {
      const res = {
        data: [
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 43828228.21181263,
            max: 563518061,
            ServiceName: 'checkout',
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 6759697.6283185845,
            max: 42092944,
            ServiceName: 'shipping',
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 6479038.598323171,
            max: 63136666,
            ServiceName: 'shipping',
            __hdx_time_bucket: '2025-11-26T12:25:00Z',
          },
        ],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
          {
            name: 'max',
            type: 'Float64',
          },
          {
            name: 'ServiceName',
            type: 'LowCardinality(String)',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(1764159780000), new Date(1764159900000)],
        granularity: '1 minute',
      });

      expect(actual.graphResults).toEqual([
        {
          __hdx_time_bucket: 1764159780,
          'AVG(toFloat64OrDefault(toString(Duration))) · checkout': 43828228.21181263,
          'AVG(toFloat64OrDefault(toString(Duration))) · shipping': 6759697.6283185845,
          'max · checkout': 563518061,
          'max · shipping': 42092944,
        },
        // Generated bucket with zeros
        {
          __hdx_time_bucket: 1764159840,
          'AVG(toFloat64OrDefault(toString(Duration))) · checkout': 0,
          'AVG(toFloat64OrDefault(toString(Duration))) · shipping': 0,
          'max · checkout': 0,
          'max · shipping': 0,
        },
        {
          __hdx_time_bucket: 1764159900,
          'AVG(toFloat64OrDefault(toString(Duration))) · shipping': 6479038.598323171,
          'max · shipping': 63136666,
        },
      ]);

      expect(actual.timestampColumn).toEqual({
        name: '__hdx_time_bucket',
        type: 'DateTime',
      });
      expect(actual.lineData).toEqual([
        {
          color: COLORS[0],
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · checkout (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          isDashed: false,
        },
        {
          color: COLORS[1],
          dataKey: 'max · checkout',
          currentPeriodKey: 'max · checkout',
          previousPeriodKey: 'max · checkout (previous)',
          displayName: 'max · checkout',
          isDashed: false,
        },
        {
          color: COLORS[2],
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · shipping (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          isDashed: false,
        },
        {
          color: COLORS[3],
          dataKey: 'max · shipping',
          currentPeriodKey: 'max · shipping',
          previousPeriodKey: 'max · shipping (previous)',
          displayName: 'max · shipping',
          isDashed: false,
        },
      ]);
    });

    it('should fill missing time buckets with zero when generateEmptyBuckets is true', () => {
      const res = {
        data: [
          {
            'count()': 10,
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'count()': 20,
            __hdx_time_bucket: '2025-11-26T12:25:00Z',
          },
        ],
        meta: [
          {
            name: 'count()',
            type: 'UInt64',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(1764159780000), new Date(1764159900000)],
        granularity: '1 minute',
        generateEmptyBuckets: true,
      });

      expect(actual.graphResults).toEqual([
        {
          __hdx_time_bucket: 1764159780,
          'count()': 10,
        },
        {
          __hdx_time_bucket: 1764159840,
          'count()': 0,
        },
        {
          __hdx_time_bucket: 1764159900,
          'count()': 20,
        },
      ]);
    });

    it('should not fill missing time buckets when generateEmptyBuckets is false', () => {
      const res = {
        data: [
          {
            'count()': 10,
            __hdx_time_bucket: '2025-11-26T12:23:00Z',
          },
          {
            'count()': 20,
            __hdx_time_bucket: '2025-11-26T12:25:00Z',
          },
        ],
        meta: [
          {
            name: 'count()',
            type: 'UInt64',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse: res,
        dateRange: [new Date(1764159780000), new Date(1764159900000)],
        granularity: '1 minute',
        generateEmptyBuckets: false,
      });

      // Should only have the two data points, no filled buckets
      expect(actual.graphResults).toEqual([
        {
          __hdx_time_bucket: 1764159780,
          'count()': 10,
        },
        {
          __hdx_time_bucket: 1764159900,
          'count()': 20,
        },
      ]);
    });

    it('should plot previous period data when provided, shifted to align with current period', () => {
      const currentPeriodResponse = {
        data: [
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 167783540.53459233,
            __hdx_time_bucket: '2025-11-26T11:12:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 182291463.92714182,
            __hdx_time_bucket: '2025-11-26T11:13:00Z',
          },
        ],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const previousPeriodResponse = {
        data: [
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 123.45,
            __hdx_time_bucket: '2025-11-26T11:10:00Z',
          },
          {
            'AVG(toFloat64OrDefault(toString(Duration)))': 678.9,
            __hdx_time_bucket: '2025-11-26T11:11:00Z',
          },
        ],
        meta: [
          {
            name: 'AVG(toFloat64OrDefault(toString(Duration)))',
            type: 'Float64',
          },
          {
            name: '__hdx_time_bucket',
            type: 'DateTime',
          },
        ],
      };

      const actual = formatResponseForTimeChart({
        currentPeriodResponse,
        previousPeriodResponse,
        dateRange: [
          new Date('2025-11-26T11:12:00Z'),
          new Date('2025-11-26T11:14:00Z'),
        ],
        granularity: '1 minute',
        generateEmptyBuckets: false,
        previousPeriodOffsetSeconds: 120,
      });

      expect(actual.graphResults).toEqual([
        {
          __hdx_time_bucket: 1764155520,
          'AVG(toFloat64OrDefault(toString(Duration)))': 167783540.53459233,
          'AVG(toFloat64OrDefault(toString(Duration))) (previous)': 123.45,
        },
        {
          __hdx_time_bucket: 1764155580,
          'AVG(toFloat64OrDefault(toString(Duration)))': 182291463.92714182,
          'AVG(toFloat64OrDefault(toString(Duration))) (previous)': 678.9,
        },
      ]);

      expect(actual.timestampColumn).toEqual({
        name: '__hdx_time_bucket',
        type: 'DateTime',
      });
      expect(actual.lineData).toEqual([
        {
          color: COLORS[0],
          currentPeriodKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration)))',
          isDashed: false,
        },
        {
          color: COLORS[0],
          currentPeriodKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          previousPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          isDashed: true,
        },
      ]);
    });
  });

  describe('convertToTimeChartConfig', () => {
    it('should set granularity when granularity is auto', () => {
      const config = {
        granularity: 'auto',
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const granularityFromFunction =
        convertToTimeChartConfig(config).granularity;

      expect(granularityFromFunction).toBe('30 minute');
    });

    it('should set granularity when granularity is undefined', () => {
      const config = {
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const granularityFromFunction =
        convertToTimeChartConfig(config).granularity;

      expect(granularityFromFunction).toBe('30 minute');
    });

    it('should retain the specified granularity when not auto', () => {
      const config = {
        granularity: '5 minute',
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const granularityFromFunction =
        convertToTimeChartConfig(config).granularity;

      expect(granularityFromFunction).toBe('5 minute');
    });
  });

  describe('convertToNumberChartConfig', () => {
    it('should remove granularity and groupBy from the config', () => {
      const config = {
        granularity: '5 minute',
        groupBy: 'ServiceName',
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const convertedConfig = convertToNumberChartConfig(config);

      expect(convertedConfig.granularity).toBeUndefined();
      expect(convertedConfig.groupBy).toBeUndefined();
    });
  });

  describe('convertToTableChartConfig', () => {
    it('should remove granularity from the config', () => {
      const config = {
        granularity: '5 minute',
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const convertedConfig = convertToTableChartConfig(config);

      expect(convertedConfig.granularity).toBeUndefined();
    });

    it('should apply a default sort if none is provided', () => {
      const config = {
        groupBy: 'ServiceName',
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const convertedConfig = convertToTableChartConfig(config);

      expect(convertedConfig.orderBy).toEqual('ServiceName');
    });

    it('should apply a default limit if none is provided', () => {
      const config = {
        groupBy: 'ServiceName',
        dateRange: [
          new Date('2025-11-26T00:00:00Z'),
          new Date('2025-11-27T00:00:00Z'),
        ],
      } as ChartConfigWithDateRange;

      const convertedConfig = convertToTableChartConfig(config);

      expect(convertedConfig.limit).toEqual({ limit: 200 });
    });
  });

  describe('formatResponseForPieChart', () => {
    const getColor = (index: number, label: string) =>
      `color-${index}-${label}`;

    it('returns empty array when data.data is empty', () => {
      const result = formatResponseForPieChart(
        {
          data: [],
          meta: [{ name: 'count()', type: 'UInt64' }],
        },
        getColor,
      );
      expect(result).toEqual([]);
    });

    it('returns empty array when there are no numeric value columns', () => {
      const result = formatResponseForPieChart(
        {
          data: [{ ServiceName: 'checkout' }],
          meta: [{ name: 'ServiceName', type: 'LowCardinality(String)' }],
        },
        getColor,
      );
      expect(result).toEqual([]);
    });

    it('uses the value column name as label when there are no group-by columns', () => {
      const result = formatResponseForPieChart(
        {
          data: [{ 'count()': 10 }],
          meta: [{ name: 'count()', type: 'UInt64' }],
        },
        getColor,
      );
      expect(result).toEqual([
        { label: 'count()', value: 10, color: 'color-0-count()' },
      ]);
    });

    it('joins group-by column values with " - " as the label', () => {
      const result = formatResponseForPieChart(
        {
          data: [
            { 'count()': 10, ServiceName: 'checkout', env: 'prod' },
            { 'count()': 5, ServiceName: 'shipping', env: 'prod' },
          ],
          meta: [
            { name: 'count()', type: 'UInt64' },
            { name: 'ServiceName', type: 'LowCardinality(String)' },
            { name: 'env', type: 'LowCardinality(String)' },
          ],
        },
        getColor,
      );
      expect(result).toEqual([
        {
          label: 'checkout - prod',
          value: 10,
          color: 'color-0-checkout - prod',
        },
        {
          label: 'shipping - prod',
          value: 5,
          color: 'color-1-shipping - prod',
        },
      ]);
    });

    it('parses string numeric values', () => {
      const result = formatResponseForPieChart(
        {
          data: [{ 'count()': '42' }],
          meta: [{ name: 'count()', type: 'UInt64' }],
        },
        getColor,
      );
      expect(result).toEqual([
        { label: 'count()', value: 42, color: 'color-0-count()' },
      ]);
    });

    it('filters out NaN values', () => {
      const result = formatResponseForPieChart(
        {
          data: [{ 'count()': 'not-a-number' }, { 'count()': 5 }],
          meta: [{ name: 'count()', type: 'UInt64' }],
        },
        getColor,
      );
      expect(result).toEqual([
        { label: 'count()', value: 5, color: 'color-0-count()' },
      ]);
    });

    it('sorts entries in descending order by value', () => {
      const result = formatResponseForPieChart(
        {
          data: [
            { 'count()': 3, ServiceName: 'c' },
            { 'count()': 10, ServiceName: 'a' },
            { 'count()': 1, ServiceName: 'b' },
          ],
          meta: [
            { name: 'count()', type: 'UInt64' },
            { name: 'ServiceName', type: 'LowCardinality(String)' },
          ],
        },
        getColor,
      );
      expect(result.map(e => e.value)).toEqual([10, 3, 1]);
    });

    it('assigns colors by sorted index', () => {
      const result = formatResponseForPieChart(
        {
          data: [
            { 'count()': 1, ServiceName: 'b' },
            { 'count()': 10, ServiceName: 'a' },
          ],
          meta: [
            { name: 'count()', type: 'UInt64' },
            { name: 'ServiceName', type: 'LowCardinality(String)' },
          ],
        },
        getColor,
      );
      // 'a' (value 10) sorts first and gets index 0; 'b' (value 1) gets index 1
      expect(result[0]).toMatchObject({ label: 'a', color: 'color-0-a' });
      expect(result[1]).toMatchObject({ label: 'b', color: 'color-1-b' });
    });

    it('uses only the first numeric column as the value column', () => {
      const result = formatResponseForPieChart(
        {
          data: [{ count: 5, duration: 999, ServiceName: 'svc' }],
          meta: [
            { name: 'count', type: 'UInt64' },
            { name: 'duration', type: 'Float64' },
            { name: 'ServiceName', type: 'LowCardinality(String)' },
          ],
        },
        getColor,
      );
      expect(result).toEqual([
        { label: 'svc', value: 5, color: 'color-0-svc' },
      ]);
    });
  });
});
