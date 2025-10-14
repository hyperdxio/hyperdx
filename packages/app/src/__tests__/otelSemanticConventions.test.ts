import { getMetricNameSql } from '../otelSemanticConventions';

describe('otelSemanticConventions', () => {
  describe('getMetricNameSql', () => {
    it('should return SQL for k8s.pod.cpu.utilization migration', () => {
      const result = getMetricNameSql('k8s.pod.cpu.utilization');
      expect(result).toBe(
        "(MetricName = 'k8s.pod.cpu.utilization' OR MetricName = 'k8s.pod.cpu.usage')",
      );
    });

    it('should return SQL for k8s.node.cpu.utilization migration', () => {
      const result = getMetricNameSql('k8s.node.cpu.utilization');
      expect(result).toBe(
        "(MetricName = 'k8s.node.cpu.utilization' OR MetricName = 'k8s.node.cpu.usage')",
      );
    });

    it('should return SQL for container.cpu.utilization migration', () => {
      const result = getMetricNameSql('container.cpu.utilization');
      expect(result).toBe(
        "(MetricName = 'container.cpu.utilization' OR MetricName = 'container.cpu.usage')",
      );
    });

    it('should return undefined for non-migrated metrics', () => {
      const result = getMetricNameSql('some.other.metric');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const result = getMetricNameSql('');
      expect(result).toBeUndefined();
    });

    it('should return undefined for new metric names', () => {
      // If someone queries using the new name directly, we shouldn't transform it
      const result = getMetricNameSql('k8s.pod.cpu.usage');
      expect(result).toBeUndefined();
    });
  });
});
