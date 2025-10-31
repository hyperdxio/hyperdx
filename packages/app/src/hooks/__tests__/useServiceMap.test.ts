import { aggregateServiceMapData, SpanAggregationRow } from '../useServiceMap';

describe('aggregateServiceMapData', () => {
  describe('basic aggregation', () => {
    it('should return empty map for empty input', () => {
      const result = aggregateServiceMapData([]);
      expect(result.size).toBe(0);
    });

    it('should aggregate single service with single status', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(1);
      expect(result.has('api-service')).toBe(true);

      const service = result.get('api-service')!;
      expect(service.serviceName).toBe('api-service');
      expect(service.incomingRequests.totalRequests).toBe(100);
      expect(service.incomingRequests.requestCountByStatus.get('Ok')).toBe(100);
      expect(service.incomingRequests.errorPercentage).toBe(0);
      expect(service.incomingRequestsByClient.size).toBe(0);
    });

    it('should aggregate multiple rows for same service and status', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 100,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 50,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(1);
      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(150);
      expect(service.incomingRequests.requestCountByStatus.get('Ok')).toBe(150);
    });

    it('should aggregate multiple status codes for same service', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 100,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          requestCount: 10,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(1);
      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(110);
      expect(service.incomingRequests.requestCountByStatus.get('Ok')).toBe(100);
      expect(service.incomingRequests.requestCountByStatus.get('Error')).toBe(
        10,
      );
    });

    it('should aggregate multiple services', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 100,
        },
        {
          serverServiceName: 'db-service',
          serverStatusCode: 'Ok',
          requestCount: 200,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(2);
      expect(result.has('api-service')).toBe(true);
      expect(result.has('db-service')).toBe(true);
      expect(result.get('api-service')!.incomingRequests.totalRequests).toBe(
        100,
      );
      expect(result.get('db-service')!.incomingRequests.totalRequests).toBe(
        200,
      );
    });
  });

  describe('error percentage calculation', () => {
    it('should calculate error percentage correctly', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 70,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Unset',
          requestCount: 20,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          requestCount: 10,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      expect(service.incomingRequests.totalRequests).toBe(100);
      expect(service.incomingRequests.errorPercentage).toBe(10);
    });

    it('should calculate 0% error when no errors', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      expect(service.incomingRequests.errorPercentage).toBe(0);
    });

    it('should calculate 100% error when all errors', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      expect(service.incomingRequests.errorPercentage).toBe(100);
    });

    it('should calculate precise error percentages', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 97,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          requestCount: 3,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      expect(service.incomingRequests.errorPercentage).toBe(3);
    });

    it('should handle 0 total requests without division by zero', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'client-service',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);

      // client-service is added but has no incoming requests
      const clientService = result.get('client-service')!;
      expect(clientService.incomingRequests.totalRequests).toBe(0);
      expect(clientService.incomingRequests.errorPercentage).toBe(0);
    });
  });

  describe('client service aggregation', () => {
    it('should aggregate requests by client service', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'web-service',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(2);
      expect(result.has('api-service')).toBe(true);
      expect(result.has('web-service')).toBe(true);

      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(100);
      expect(service.incomingRequestsByClient.size).toBe(1);
      expect(service.incomingRequestsByClient.has('web-service')).toBe(true);

      const clientStats = service.incomingRequestsByClient.get('web-service')!;
      expect(clientStats.totalRequests).toBe(100);
      expect(clientStats.requestCountByStatus.get('Ok')).toBe(100);
    });

    it('should aggregate multiple clients calling same service', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'web-service',
          requestCount: 100,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'mobile-service',
          requestCount: 50,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(3); // api-service, web-service, mobile-service
      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(150);
      expect(service.incomingRequestsByClient.size).toBe(2);

      const webStats = service.incomingRequestsByClient.get('web-service')!;
      expect(webStats.totalRequests).toBe(100);

      const mobileStats =
        service.incomingRequestsByClient.get('mobile-service')!;
      expect(mobileStats.totalRequests).toBe(50);
    });

    it('should aggregate multiple requests from same client with different status codes', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'web-service',
          requestCount: 90,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          clientServiceName: 'web-service',
          requestCount: 10,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;
      const clientStats = service.incomingRequestsByClient.get('web-service')!;

      expect(clientStats.totalRequests).toBe(100);
      expect(clientStats.requestCountByStatus.get('Ok')).toBe(90);
      expect(clientStats.requestCountByStatus.get('Error')).toBe(10);
      expect(clientStats.errorPercentage).toBe(10);
    });

    it('should handle mix of requests with and without client service names', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'web-service',
          requestCount: 100,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 50, // No client service (uninstrumented)
        },
      ];

      const result = aggregateServiceMapData(data);

      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(150);
      expect(service.incomingRequestsByClient.size).toBe(1);
      expect(service.incomingRequestsByClient.has('web-service')).toBe(true);
    });

    it('should create client service entry even if client has no incoming requests', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'web-service',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.has('web-service')).toBe(true);
      const clientService = result.get('web-service')!;
      expect(clientService.serviceName).toBe('web-service');
      expect(clientService.incomingRequests.totalRequests).toBe(0);
      expect(clientService.incomingRequestsByClient.size).toBe(0);
      expect(clientService.incomingRequests.errorPercentage).toBe(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle service chain (A -> B -> C)', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'service-b',
          serverStatusCode: 'Ok',
          clientServiceName: 'service-a',
          requestCount: 100,
        },
        {
          serverServiceName: 'service-c',
          serverStatusCode: 'Ok',
          clientServiceName: 'service-b',
          requestCount: 100,
        },
      ];

      const result = aggregateServiceMapData(data);

      expect(result.size).toBe(3);

      // Service A (no incoming requests)
      const serviceA = result.get('service-a')!;
      expect(serviceA.incomingRequests.totalRequests).toBe(0);

      // Service B (receives from A, calls C)
      const serviceB = result.get('service-b')!;
      expect(serviceB.incomingRequests.totalRequests).toBe(100);
      expect(serviceB.incomingRequestsByClient.has('service-a')).toBe(true);

      // Service C (receives from B)
      const serviceC = result.get('service-c')!;
      expect(serviceC.incomingRequests.totalRequests).toBe(100);
      expect(serviceC.incomingRequestsByClient.has('service-b')).toBe(true);
    });

    it('should handle multiple clients with different error rates', () => {
      const data: SpanAggregationRow[] = [
        // Client 1: 10% error rate
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'client-1',
          requestCount: 90,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          clientServiceName: 'client-1',
          requestCount: 10,
        },
        // Client 2: 50% error rate
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          clientServiceName: 'client-2',
          requestCount: 50,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          clientServiceName: 'client-2',
          requestCount: 50,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      // Overall error rate: 60 errors out of 200 = 30%
      expect(service.incomingRequests.totalRequests).toBe(200);
      expect(service.incomingRequests.errorPercentage).toBe(30);

      // Client 1: 10% error rate
      const client1Stats = service.incomingRequestsByClient.get('client-1')!;
      expect(client1Stats.errorPercentage).toBe(10);

      // Client 2: 50% error rate
      const client2Stats = service.incomingRequestsByClient.get('client-2')!;
      expect(client2Stats.errorPercentage).toBe(50);
    });

    it('should handle large request counts', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 1_000_000,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          requestCount: 1_000,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      expect(service.incomingRequests.totalRequests).toBe(1_001_000);
      expect(service.incomingRequests.errorPercentage).toBeCloseTo(0.0999, 4);
    });

    it('should handle different status code strings', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 50,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Error',
          requestCount: 10,
        },
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Unset',
          requestCount: 40,
        },
      ];

      const result = aggregateServiceMapData(data);
      const service = result.get('api-service')!;

      expect(service.incomingRequests.totalRequests).toBe(100);
      expect(service.incomingRequests.requestCountByStatus.get('Ok')).toBe(50);
      expect(service.incomingRequests.requestCountByStatus.get('Error')).toBe(
        10,
      );
      expect(service.incomingRequests.requestCountByStatus.get('Unset')).toBe(
        40,
      );
      expect(service.incomingRequests.errorPercentage).toBe(10);
    });
  });

  describe('data structure integrity', () => {
    it('should not mutate input data', () => {
      const data: SpanAggregationRow[] = [
        {
          serverServiceName: 'api-service',
          serverStatusCode: 'Ok',
          requestCount: 100,
        },
      ];

      const originalData = JSON.parse(JSON.stringify(data));
      aggregateServiceMapData(data);

      expect(data).toEqual(originalData);
    });
  });
});
