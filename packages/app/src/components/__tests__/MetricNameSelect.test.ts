import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { getMetricOptions } from '@/components/MetricNameSelect';
import type { QueryableMetricKind } from '@/utils/metricKinds';

const SEPARATOR = ':::::::';

/** Builds the per-kind name map `getMetricOptions` takes, defaulting to none. */
const kinds = ({
  gauge,
  sum,
  histogram,
  exponentialHistogram,
}: {
  gauge?: string[];
  sum?: string[];
  histogram?: string[];
  exponentialHistogram?: string[];
} = {}): Record<QueryableMetricKind, string[] | undefined> => ({
  [MetricsDataType.Gauge]: gauge,
  [MetricsDataType.Sum]: sum,
  [MetricsDataType.Histogram]: histogram,
  [MetricsDataType.ExponentialHistogram]: exponentialHistogram,
});

describe('getMetricOptions', () => {
  describe('no metrics provided', () => {
    it('returns empty array when all metric lists are undefined', () => {
      const result = getMetricOptions(kinds(), null, MetricsDataType.Gauge);
      expect(result).toEqual([]);
    });

    it('returns empty array when all metric lists are empty', () => {
      const result = getMetricOptions(
        kinds({ gauge: [], sum: [], histogram: [], exponentialHistogram: [] }),
        null,
        MetricsDataType.Gauge,
      );
      expect(result).toEqual([]);
    });

    it('adds saved metricName when it is not in empty results', () => {
      const result = getMetricOptions(
        kinds(),
        'my.metric',
        MetricsDataType.Sum,
      );
      expect(result).toEqual([
        {
          value: `my.metric${SEPARATOR}sum`,
          label: 'my.metric (Sum)',
        },
      ]);
    });
  });

  describe('one metric in a single argument list', () => {
    it('returns a single gauge option', () => {
      const result = getMetricOptions(
        kinds({ gauge: ['cpu.usage'] }),
        null,
        MetricsDataType.Gauge,
      );
      expect(result).toEqual([
        { value: `cpu.usage${SEPARATOR}gauge`, label: 'cpu.usage (Gauge)' },
      ]);
    });

    it('returns a single histogram option', () => {
      const result = getMetricOptions(
        kinds({ histogram: ['request.duration'] }),
        null,
        MetricsDataType.Histogram,
      );
      expect(result).toEqual([
        {
          value: `request.duration${SEPARATOR}histogram`,
          label: 'request.duration (Histogram)',
        },
      ]);
    });

    it('returns a single sum option', () => {
      const result = getMetricOptions(
        kinds({ sum: ['bytes.sent'] }),
        null,
        MetricsDataType.Sum,
      );
      expect(result).toEqual([
        { value: `bytes.sent${SEPARATOR}sum`, label: 'bytes.sent (Sum)' },
      ]);
    });

    it('returns a single exponential histogram option', () => {
      const result = getMetricOptions(
        kinds({ exponentialHistogram: ['request.duration'] }),
        null,
        MetricsDataType.ExponentialHistogram,
      );
      expect(result).toEqual([
        {
          value: `request.duration${SEPARATOR}${MetricsDataType.ExponentialHistogram}`,
          label: 'request.duration (Exp. histogram)',
        },
      ]);
    });

    it('does not duplicate a saved metricName already present in results', () => {
      const result = getMetricOptions(
        kinds({ gauge: ['cpu.usage'] }),
        'cpu.usage',
        MetricsDataType.Gauge,
      );
      expect(result).toHaveLength(1);
      expect(result).toContainEqual({
        value: `cpu.usage${SEPARATOR}gauge`,
        label: 'cpu.usage (Gauge)',
      });
    });

    it('appends saved metricName when it is not in single-entry results', () => {
      const result = getMetricOptions(
        kinds({ gauge: ['cpu.usage'] }),
        'missing.metric',
        MetricsDataType.Gauge,
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        value: `missing.metric${SEPARATOR}gauge`,
        label: 'missing.metric (Gauge)',
      });
    });
  });

  describe('multiple metrics in each argument list', () => {
    const all = () =>
      kinds({
        gauge: ['cpu.usage', 'mem.usage', 'disk.usage'],
        histogram: ['request.duration', 'db.query.duration'],
        sum: ['bytes.sent', 'bytes.received', 'requests.total'],
        exponentialHistogram: ['http.request.duration', 'rpc.server.duration'],
      });

    it('returns all options for all metric types', () => {
      const result = getMetricOptions(all(), null, MetricsDataType.Gauge);

      expect(result).toHaveLength(10);

      expect(result).toContainEqual({
        value: `cpu.usage${SEPARATOR}gauge`,
        label: 'cpu.usage (Gauge)',
      });
      expect(result).toContainEqual({
        value: `mem.usage${SEPARATOR}gauge`,
        label: 'mem.usage (Gauge)',
      });
      expect(result).toContainEqual({
        value: `disk.usage${SEPARATOR}gauge`,
        label: 'disk.usage (Gauge)',
      });
      expect(result).toContainEqual({
        value: `request.duration${SEPARATOR}histogram`,
        label: 'request.duration (Histogram)',
      });
      expect(result).toContainEqual({
        value: `db.query.duration${SEPARATOR}histogram`,
        label: 'db.query.duration (Histogram)',
      });
      expect(result).toContainEqual({
        value: `bytes.sent${SEPARATOR}sum`,
        label: 'bytes.sent (Sum)',
      });
      expect(result).toContainEqual({
        value: `bytes.received${SEPARATOR}sum`,
        label: 'bytes.received (Sum)',
      });
      expect(result).toContainEqual({
        value: `requests.total${SEPARATOR}sum`,
        label: 'requests.total (Sum)',
      });
      expect(result).toContainEqual({
        value: `http.request.duration${SEPARATOR}${MetricsDataType.ExponentialHistogram}`,
        label: 'http.request.duration (Exp. histogram)',
      });
      expect(result).toContainEqual({
        value: `rpc.server.duration${SEPARATOR}${MetricsDataType.ExponentialHistogram}`,
        label: 'rpc.server.duration (Exp. histogram)',
      });
    });

    // Grouping order comes from QUERYABLE_KINDS, which is what the dropdown
    // renders top to bottom.
    it('groups the options gauge, sum, histogram, exponential histogram', () => {
      const result = getMetricOptions(all(), null, MetricsDataType.Gauge);

      expect(result.map(option => option.value.split(SEPARATOR)[1])).toEqual([
        'gauge',
        'gauge',
        'gauge',
        'sum',
        'sum',
        'sum',
        'histogram',
        'histogram',
        MetricsDataType.ExponentialHistogram,
        MetricsDataType.ExponentialHistogram,
      ]);
    });

    it('does not duplicate a saved metricName already present among multiple options', () => {
      const result = getMetricOptions(
        all(),
        'mem.usage',
        MetricsDataType.Gauge,
      );
      expect(result).toHaveLength(10);
      const values = result.map(r => r.value);
      expect(
        values.filter(v => v === `mem.usage${SEPARATOR}gauge`),
      ).toHaveLength(1);
    });

    it('appends saved metricName when absent from multiple-option results', () => {
      const result = getMetricOptions(
        all(),
        'absent.metric',
        MetricsDataType.Histogram,
      );
      expect(result).toHaveLength(11);
      expect(result).toContainEqual({
        value: `absent.metric${SEPARATOR}histogram`,
        label: 'absent.metric (Histogram)',
      });
    });
  });
});
