import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { resolveSourceIds } from '@/KubernetesDashboardPage';

describe('resolveSourceIds', () => {
  const mockLogSource: TSource = {
    id: 'log-1',
    name: 'Log Source 1',
    kind: SourceKind.Log,
    connection: 'connection-1',
    metricSourceId: 'metric-1',
  } as TSource;

  const mockMetricSource: TSource = {
    id: 'metric-1',
    name: 'Metric Source 1',
    kind: SourceKind.Metric,
    connection: 'connection-1',
    logSourceId: 'log-1',
  } as TSource;

  const mockMetricSourceNotCorrelated: TSource = {
    id: 'metric-1-not-correlated',
    name: 'Metric Source Not Correlated',
    kind: SourceKind.Metric,
    connection: 'connection-1',
  } as TSource;

  const mockLogSourceNotCorrelated: TSource = {
    id: 'log-1-not-correlated',
    name: 'Log Source Not Correlated',
    kind: SourceKind.Log,
    connection: 'connection-1',
  } as TSource;

  const mockLogSource2: TSource = {
    id: 'log-2',
    name: 'Log Source 2',
    kind: SourceKind.Log,
    connection: 'connection-2',
  } as TSource;

  const mockMetricSource2: TSource = {
    id: 'metric-2',
    name: 'Metric Source 2',
    kind: SourceKind.Metric,
    connection: 'connection-2',
  } as TSource;

  describe('when both source IDs are provided', () => {
    it('should return both source IDs as-is', () => {
      const result = resolveSourceIds('log-1', 'metric-1', [
        mockLogSource,
        mockMetricSource,
      ]);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });

    it('should return both source IDs even if sources array is undefined', () => {
      const result = resolveSourceIds('log-1', 'metric-1', undefined);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });

    it('should return both source IDs even if they are not in the sources array', () => {
      const result = resolveSourceIds('log-999', 'metric-999', [
        mockLogSource,
        mockMetricSource,
      ]);
      expect(result).toEqual({
        logSourceId: 'log-999',
        metricSourceId: 'metric-999',
      });
    });
  });

  describe('when only log source ID is provided', () => {
    it('should return the correlated metric source when one is available', () => {
      const sources = [
        mockLogSourceNotCorrelated,
        mockLogSource,
        mockMetricSourceNotCorrelated,
        mockMetricSource,
        mockMetricSource2,
        mockLogSource2,
      ];
      const result = resolveSourceIds('log-1', null, sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });

    it('should find metric source from the same connection if there is no correlated metric source', () => {
      const sources = [
        mockLogSource,
        mockMetricSource,
        mockMetricSource2,
        mockLogSource2,
      ];
      const result = resolveSourceIds('log-2', null, sources);
      expect(result).toEqual({
        logSourceId: 'log-2',
        metricSourceId: 'metric-2',
      });
    });

    it('should return undefined for metric source if no matching connection', () => {
      const sources = [mockLogSource, mockMetricSource2];
      const result = resolveSourceIds('log-1', null, sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: undefined,
      });
    });

    it('should return undefined for metric source if log source not found', () => {
      const sources = [mockLogSource, mockMetricSource];
      const result = resolveSourceIds('log-999', null, sources);
      expect(result).toEqual({
        logSourceId: 'log-999',
        metricSourceId: undefined,
      });
    });

    it('should return log source ID and undefined if sources array is undefined', () => {
      const result = resolveSourceIds('log-1', null, undefined);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: undefined,
      });
    });

    it('should handle undefined metric source ID', () => {
      const sources = [mockLogSource, mockMetricSource];
      const result = resolveSourceIds('log-1', undefined, sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });
  });

  describe('when only metric source ID is provided', () => {
    it('should return the correlated metric source when one is available', () => {
      const sources = [
        mockLogSourceNotCorrelated,
        mockLogSource,
        mockMetricSourceNotCorrelated,
        mockMetricSource,
        mockMetricSource2,
        mockLogSource2,
      ];
      const result = resolveSourceIds('log-1', null, sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });

    it('should find log source from the same connection when there is no correlated log source', () => {
      const sources = [
        mockLogSourceNotCorrelated,
        mockMetricSource,
        mockLogSource2,
        mockMetricSource2,
      ];
      const result = resolveSourceIds(null, 'metric-1', sources);
      expect(result).toEqual({
        logSourceId: 'log-1-not-correlated',
        metricSourceId: 'metric-1',
      });
    });

    it('should return undefined for log source if no matching connection', () => {
      const sources = [mockLogSource2, mockMetricSource];
      const result = resolveSourceIds(null, 'metric-1', sources);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: 'metric-1',
      });
    });

    it('should return undefined for log source if metric source not found', () => {
      const sources = [mockLogSource, mockMetricSource];
      const result = resolveSourceIds(null, 'metric-999', sources);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: 'metric-999',
      });
    });

    it('should return undefined and metric source ID if sources array is undefined', () => {
      const result = resolveSourceIds(null, 'metric-1', undefined);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: 'metric-1',
      });
    });

    it('should handle undefined log source ID', () => {
      const sources = [mockLogSource, mockMetricSource];
      const result = resolveSourceIds(undefined, 'metric-1', sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });
  });

  describe('when neither source ID is provided', () => {
    it('should return two correlated sources, if available', () => {
      const sources = [
        mockLogSourceNotCorrelated,
        mockLogSource,
        mockMetricSourceNotCorrelated,
        mockMetricSource,
        mockMetricSource2,
        mockLogSource2,
      ];
      const result = resolveSourceIds(null, null, sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });

    it('should find log and metric sources from the same connection, if there are no correlated sources', () => {
      const sources = [
        mockLogSourceNotCorrelated,
        mockMetricSourceNotCorrelated,
        mockLogSource2,
        mockMetricSource2,
      ];
      const result = resolveSourceIds(null, null, sources);
      expect(result).toEqual({
        logSourceId: 'log-1-not-correlated',
        metricSourceId: 'metric-1-not-correlated',
      });
    });

    it('should return sources from the connection with both source kinds', () => {
      const sources = [mockLogSource2, mockLogSource, mockMetricSource];
      const result = resolveSourceIds(null, null, sources);
      expect(result).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });
    });

    it('should handle connection with only one source kind', () => {
      const sources = [mockLogSource, mockMetricSource2];
      const result = resolveSourceIds(null, null, sources);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: undefined,
      });
    });

    it('should return [null, null] if sources array is undefined', () => {
      const result = resolveSourceIds(null, null, undefined);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: undefined,
      });
    });

    it('should return [undefined, undefined] if sources array is empty', () => {
      const result = resolveSourceIds(null, null, []);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: undefined,
      });
    });

    it('should return [undefined, undefined] if no connection has both kinds', () => {
      const sources = [mockLogSource];
      const result = resolveSourceIds(null, null, sources);
      expect(result).toEqual({
        logSourceId: undefined,
        metricSourceId: undefined,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle multiple sources on the same connection', () => {
      const logSource3: TSource = {
        id: 'log-3',
        name: 'Log Source 3',
        kind: SourceKind.Log,
        connection: 'connection-1',
      } as TSource;
      const metricSource3: TSource = {
        id: 'metric-3',
        name: 'Metric Source 3',
        kind: SourceKind.Metric,
        connection: 'connection-1',
      } as TSource;
      const sources = [
        mockLogSource,
        logSource3,
        mockMetricSource,
        metricSource3,
      ];

      // When log source is specified, should find first metric on same connection
      const result1 = resolveSourceIds('log-1', null, sources);
      expect(result1).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-1',
      });

      // When metric source is specified, should find first log on same connection
      const result2 = resolveSourceIds(null, 'metric-3', sources);
      expect(result2).toEqual({
        logSourceId: 'log-1',
        metricSourceId: 'metric-3',
      });
    });
  });
});
