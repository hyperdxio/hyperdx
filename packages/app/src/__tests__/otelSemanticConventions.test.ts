import { getMetricNameSql } from '../otelSemanticConventions';

describe('otelSemanticConventions', () => {
  describe('getMetricNameSql', () => {
    it('should return SQL for k8s.pod.cpu.utilization migration', () => {
      const result = getMetricNameSql('k8s.pod.cpu.utilization');
      expect(result).toBe(
        "if(greaterOrEquals(ScopeVersion, '0.125.0'), 'k8s.pod.cpu.usage', 'k8s.pod.cpu.utilization')",
      );
    });

    it('should return SQL for k8s.node.cpu.utilization migration', () => {
      const result = getMetricNameSql('k8s.node.cpu.utilization');
      expect(result).toBe(
        "if(greaterOrEquals(ScopeVersion, '0.125.0'), 'k8s.node.cpu.usage', 'k8s.node.cpu.utilization')",
      );
    });

    it('should return SQL for container.cpu.utilization migration', () => {
      const result = getMetricNameSql('container.cpu.utilization');
      expect(result).toBe(
        "if(greaterOrEquals(ScopeVersion, '0.125.0'), 'container.cpu.usage', 'container.cpu.utilization')",
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
