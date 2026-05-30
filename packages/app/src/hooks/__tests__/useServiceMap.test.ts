import { aggregateServiceMapData, SpanAggregationRow } from '../useServiceMap';

// Convenience builders for the GROUPING SETS row shapes.
function nodeRow(
  serverServiceName: string,
  requestCount: number,
  errorCount: number,
  latency?: { p50: number; p95: number; p99: number },
): SpanAggregationRow {
  return {
    serverServiceName,
    isNodeLevel: 1,
    requestCount,
    errorCount,
    ...latency,
  };
}

function edgeRow(
  serverServiceName: string,
  clientServiceName: string | undefined,
  requestCount: number,
  errorCount: number,
  latency?: { p50: number; p95: number; p99: number },
): SpanAggregationRow {
  return {
    serverServiceName,
    clientServiceName,
    isNodeLevel: 0,
    requestCount,
    errorCount,
    ...latency,
  };
}

describe('aggregateServiceMapData', () => {
  describe('basic aggregation', () => {
    it('returns an empty map for empty input', () => {
      expect(aggregateServiceMapData([]).size).toBe(0);
    });

    it('builds a service from a node-level row', () => {
      const result = aggregateServiceMapData([nodeRow('api-service', 100, 0)]);

      expect(result.size).toBe(1);
      const service = result.get('api-service')!;
      expect(service.serviceName).toBe('api-service');
      expect(service.incomingRequests.totalRequests).toBe(100);
      expect(service.incomingRequests.errorCount).toBe(0);
      expect(service.incomingRequests.errorPercentage).toBe(0);
      expect(service.incomingRequestsByClient.size).toBe(0);
    });

    it('uses the node-level row as the rolled-up total (no client summing)', () => {
      // Node-level totals come straight from the rolled-up row, independent of
      // the per-edge rows.
      const result = aggregateServiceMapData([
        nodeRow('api-service', 150, 15),
        edgeRow('api-service', 'web', 100, 10),
        edgeRow('api-service', 'worker', 50, 5),
      ]);

      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(150);
      expect(service.incomingRequests.errorCount).toBe(15);
      expect(service.incomingRequestsByClient.size).toBe(2);
    });
  });

  describe('error percentage', () => {
    it('computes errorPercentage from errorCount / totalRequests', () => {
      const result = aggregateServiceMapData([nodeRow('api-service', 100, 10)]);
      expect(result.get('api-service')!.incomingRequests.errorPercentage).toBe(
        10,
      );
    });

    it('is 100 when all requests error', () => {
      const result = aggregateServiceMapData([nodeRow('api-service', 30, 30)]);
      expect(result.get('api-service')!.incomingRequests.errorPercentage).toBe(
        100,
      );
    });

    it('avoids division by zero for zero-request services', () => {
      // A client-only node, created from an edge row, has no incoming requests.
      const result = aggregateServiceMapData([
        edgeRow('api-service', 'web', 100, 0),
      ]);
      const web = result.get('web')!;
      expect(web.incomingRequests.totalRequests).toBe(0);
      expect(web.incomingRequests.errorPercentage).toBe(0);
    });
  });

  describe('edges (per-client stats)', () => {
    it('records per-client stats and creates the client node', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0),
        edgeRow('api-service', 'web-service', 100, 0),
      ]);

      expect(result.size).toBe(2);
      expect(result.has('web-service')).toBe(true);

      const service = result.get('api-service')!;
      const fromWeb = service.incomingRequestsByClient.get('web-service')!;
      expect(fromWeb.totalRequests).toBe(100);
    });

    it('supports multiple clients calling the same service', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 150, 0),
        edgeRow('api-service', 'web', 100, 0),
        edgeRow('api-service', 'mobile', 50, 5),
      ]);

      const service = result.get('api-service')!;
      expect(service.incomingRequestsByClient.size).toBe(2);
      expect(
        service.incomingRequestsByClient.get('mobile')!.errorPercentage,
      ).toBe(10);
    });

    it('ignores edge rows from uninstrumented (null) clients', () => {
      // These are already counted in the node-level total; no edge is drawn.
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0),
        edgeRow('api-service', undefined, 40, 0),
      ]);

      const service = result.get('api-service')!;
      expect(service.incomingRequestsByClient.size).toBe(0);
      expect(result.size).toBe(1);
    });

    it('builds a chain A -> B -> C', () => {
      const result = aggregateServiceMapData([
        nodeRow('B', 100, 0),
        edgeRow('B', 'A', 100, 0),
        nodeRow('C', 80, 0),
        edgeRow('C', 'B', 80, 0),
      ]);

      expect(new Set(result.keys())).toEqual(new Set(['A', 'B', 'C']));
      expect(result.get('B')!.incomingRequestsByClient.has('A')).toBe(true);
      expect(result.get('C')!.incomingRequestsByClient.has('B')).toBe(true);
      // A is a leaf client with no incoming traffic.
      expect(result.get('A')!.incomingRequests.totalRequests).toBe(0);
    });
  });

  describe('outgoing throughput', () => {
    it('rolls edge volume up to the caller as outgoingRequests', () => {
      const result = aggregateServiceMapData([
        nodeRow('api', 100, 0),
        edgeRow('api', 'web', 100, 0),
      ]);

      // web calls api 100x -> web has 100 outgoing, 0 incoming.
      expect(result.get('web')!.outgoingRequests).toBe(100);
      expect(result.get('web')!.incomingRequests.totalRequests).toBe(0);
      // api receives but makes no calls of its own here.
      expect(result.get('api')!.outgoingRequests).toBe(0);
    });

    it('sums outgoing across multiple callees', () => {
      const result = aggregateServiceMapData([
        nodeRow('api', 100, 0),
        edgeRow('api', 'gateway', 100, 0),
        nodeRow('db', 60, 0),
        edgeRow('db', 'gateway', 60, 0),
      ]);

      // gateway calls api (100) and db (60) -> 160 outgoing.
      expect(result.get('gateway')!.outgoingRequests).toBe(160);
    });

    it('accumulates both incoming and outgoing for a mid-chain service', () => {
      // A -> B -> C : B receives 100 and makes 80.
      const result = aggregateServiceMapData([
        nodeRow('B', 100, 0),
        edgeRow('B', 'A', 100, 0),
        nodeRow('C', 80, 0),
        edgeRow('C', 'B', 80, 0),
      ]);

      expect(result.get('B')!.incomingRequests.totalRequests).toBe(100);
      expect(result.get('B')!.outgoingRequests).toBe(80);
      expect(result.get('A')!.outgoingRequests).toBe(100);
      expect(result.get('C')!.outgoingRequests).toBe(0);
    });
  });

  describe('latency percentiles', () => {
    it('passes through percentiles and flags hasLatency', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0, { p50: 5, p95: 20, p99: 50 }),
      ]);

      const stats = result.get('api-service')!.incomingRequests;
      expect(stats.p50).toBe(5);
      expect(stats.p95).toBe(20);
      expect(stats.p99).toBe(50);
      expect(stats.hasLatency).toBe(true);
    });

    it('marks hasLatency false and zeroes percentiles when absent', () => {
      const stats = aggregateServiceMapData([
        nodeRow('api-service', 100, 0),
      ]).get('api-service')!.incomingRequests;
      expect(stats.hasLatency).toBe(false);
      expect(stats.p50).toBe(0);
      expect(stats.p95).toBe(0);
      expect(stats.p99).toBe(0);
    });

    it('records per-edge percentiles independently of the node', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0, { p50: 5, p95: 20, p99: 50 }),
        edgeRow('api-service', 'web', 100, 0, { p50: 8, p95: 30, p99: 60 }),
      ]);

      const fromWeb = result
        .get('api-service')!
        .incomingRequestsByClient.get('web')!;
      expect(fromWeb.p95).toBe(30);
      expect(fromWeb.hasLatency).toBe(true);
    });
  });

  describe('data structure integrity', () => {
    it('does not mutate the input rows', () => {
      const data: SpanAggregationRow[] = [
        nodeRow('api-service', 100, 10, { p50: 1, p95: 2, p99: 3 }),
        edgeRow('api-service', 'web', 100, 10),
      ];
      const original = JSON.parse(JSON.stringify(data));
      aggregateServiceMapData(data);
      expect(data).toEqual(original);
    });
  });
});
