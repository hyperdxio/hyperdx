import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { classifyMetric } from '@/components/MetricWall/classifyMetric';

const { Gauge, Sum, Histogram } = MetricsDataType;

describe('classifyMetric', () => {
  it.each([
    ['http.server.request.duration', Histogram, 'ms', 'latency', 'unit'],
    ['jvm.gc.duration', Histogram, 's', 'latency', 'unit'],
    ['node_cpu_seconds_total', Sum, 's', 'saturation', 'unit'],
    ['container_memory_working_set_bytes', Gauge, 'By', 'saturation', 'unit'],
    ['k8s.pod.cpu.utilization', Gauge, '%', 'saturation', 'unit'],
    ['system.disk.io', Sum, 'By/s', 'throughput', 'unit'],
    ['http.server.error.count', Sum, '1', 'errors', 'name'],
    ['kafka.consumer.lag', Gauge, '1', 'queue', 'name'],
    ['db_connection_errors_total', Sum, undefined, 'errors', 'name'],
    ['orders_processed', Sum, undefined, 'unclassified', 'fallback'],
    ['biz.checkout.v2', Gauge, undefined, 'unclassified', 'fallback'],
  ])('%s (%s, %s) is %s by %s', (name, type, unit, quantity, reason) => {
    expect(classifyMetric({ name, type, unit })).toEqual({ quantity, reason });
  });

  it('reads a dimensionless sum as a counter when nothing else says what it is', () => {
    expect(
      classifyMetric({ name: 'orders.processed', type: Sum, unit: '1' }),
    ).toEqual({ quantity: 'errors', reason: 'kind' });
  });

  it('never classifies from the head of the name', () => {
    expect(
      classifyMetric({ name: 'latency.orders', type: Gauge }).quantity,
    ).toBe('unclassified');
  });
});
