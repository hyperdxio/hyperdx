import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { getMetricOptions } from '../MetricNameSelect';

const SEPARATOR = ':::::::';

describe('getMetricOptions', () => {
  describe('no metrics provided', () => {
    it('returns empty array when all metric lists are undefined', () => {
      const result = getMetricOptions(
        undefined,
        undefined,
        undefined,
        null,
        MetricsDataType.Gauge,
      );
      expect(result).toEqual([]);
    });

    it('returns empty array when all metric lists are empty', () => {
      const result = getMetricOptions([], [], [], null, MetricsDataType.Gauge);
      expect(result).toEqual([]);
    });

    it('adds saved metricName when it is not in empty results', () => {
      const result = getMetricOptions(
        undefined,
        undefined,
        undefined,
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
        ['cpu.usage'],
        undefined,
        undefined,
        null,
        MetricsDataType.Gauge,
      );
      expect(result).toEqual([
        { value: `cpu.usage${SEPARATOR}gauge`, label: 'cpu.usage (Gauge)' },
      ]);
    });

    it('returns a single histogram option', () => {
      const result = getMetricOptions(
        undefined,
        ['request.duration'],
        undefined,
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
        undefined,
        undefined,
        ['bytes.sent'],
        null,
        MetricsDataType.Sum,
      );
      expect(result).toEqual([
        { value: `bytes.sent${SEPARATOR}sum`, label: 'bytes.sent (Sum)' },
      ]);
    });

    it('does not duplicate a saved metricName already present in results', () => {
      const result = getMetricOptions(
        ['cpu.usage'],
        undefined,
        undefined,
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
        ['cpu.usage'],
        undefined,
        undefined,
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
    const gaugeMetrics = ['cpu.usage', 'mem.usage', 'disk.usage'];
    const histogramMetrics = ['request.duration', 'db.query.duration'];
    const sumMetrics = ['bytes.sent', 'bytes.received', 'requests.total'];

    it('returns all options for all metric types', () => {
      const result = getMetricOptions(
        gaugeMetrics,
        histogramMetrics,
        sumMetrics,
        null,
        MetricsDataType.Gauge,
      );

      expect(result).toHaveLength(8);

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
    });

    it('does not duplicate a saved metricName already present among multiple options', () => {
      const result = getMetricOptions(
        gaugeMetrics,
        histogramMetrics,
        sumMetrics,
        'mem.usage',
        MetricsDataType.Gauge,
      );
      expect(result).toHaveLength(8);
      const values = result.map(r => r.value);
      expect(
        values.filter(v => v === `mem.usage${SEPARATOR}gauge`),
      ).toHaveLength(1);
    });

    it('appends saved metricName when absent from multiple-option results', () => {
      const result = getMetricOptions(
        gaugeMetrics,
        histogramMetrics,
        sumMetrics,
        'absent.metric',
        MetricsDataType.Histogram,
      );
      expect(result).toHaveLength(9);
      expect(result).toContainEqual({
        value: `absent.metric${SEPARATOR}histogram`,
        label: 'absent.metric (Histogram)',
      });
    });
  });
});
