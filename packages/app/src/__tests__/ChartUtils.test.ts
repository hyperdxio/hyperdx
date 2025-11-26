import { c } from 'nuqs/dist/serializer-RqlbYgUW';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { formatResponseForTimeChart } from '@/ChartUtils';

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
          color: '#20c997',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          currentPeriodKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
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
          color: '#20c997',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          isDashed: false,
        },
        {
          color: '#8250dc',
          dataKey: 'max · checkout',
          currentPeriodKey: 'max · checkout',
          displayName: 'max · checkout',
          isDashed: false,
        },
        {
          color: '#cdad7a',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          isDashed: false,
        },
        {
          color: '#0d6efd',
          dataKey: 'max · shipping',
          currentPeriodKey: 'max · shipping',
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
          color: '#20c997',
          dataKey: 'info',
          currentPeriodKey: 'info',
          displayName: 'info',
          isDashed: false,
        },
        {
          color: '#20c997',
          dataKey: 'debug',
          currentPeriodKey: 'debug',
          displayName: 'debug',
          isDashed: false,
        },
        {
          color: '#F81358',
          dataKey: 'error',
          currentPeriodKey: 'error',
          displayName: 'error',
          isDashed: false,
        },
      ]);
    });

    it('should zero-fill missing time buckets', () => {
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
        generateEmptyBuckets: true,
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
          color: '#20c997',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · checkout',
          isDashed: false,
        },
        {
          color: '#8250dc',
          dataKey: 'max · checkout',
          currentPeriodKey: 'max · checkout',
          displayName: 'max · checkout',
          isDashed: false,
        },
        {
          color: '#cdad7a',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          currentPeriodKey:
            'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) · shipping',
          isDashed: false,
        },
        {
          color: '#0d6efd',
          dataKey: 'max · shipping',
          currentPeriodKey: 'max · shipping',
          displayName: 'max · shipping',
          isDashed: false,
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
          color: '#20c997',
          currentPeriodKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration)))',
          isDashed: false,
        },
        {
          color: '#20c997',
          currentPeriodKey: 'AVG(toFloat64OrDefault(toString(Duration)))',
          dataKey: 'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          displayName: 'AVG(toFloat64OrDefault(toString(Duration))) (previous)',
          isDashed: true,
        },
      ]);
    });
  });
});
