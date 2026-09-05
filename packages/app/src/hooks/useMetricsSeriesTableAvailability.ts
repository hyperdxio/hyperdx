import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import { useQueries, useQuery } from '@tanstack/react-query';

import api from '@/api';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { hasSeriesHashColumn, isValidMetricTable } from '@/source';

type MetricsSeriesTableAvailabilityStatus =
  | 'disabled'
  | 'not_configured'
  | 'loading'
  | 'invalid_series'
  | 'missing_series_hash'
  | 'ready';

export interface MetricsSeriesTableAvailability {
  status: MetricsSeriesTableAvailabilityStatus;
  missingSeriesHashTables: string[];
}

export function computeMetricsSeriesTableAvailability({
  isMetricsSeriesTableEnabled,
  seriesTableName,
  isLoading,
  isSeriesValid,
  missingSeriesHashTables,
}: {
  isMetricsSeriesTableEnabled: boolean;
  seriesTableName: string | undefined;
  isLoading: boolean;
  isSeriesValid: boolean;
  missingSeriesHashTables: string[];
}): MetricsSeriesTableAvailability {
  if (!isMetricsSeriesTableEnabled) {
    return { status: 'disabled', missingSeriesHashTables: [] };
  }
  if (!seriesTableName) {
    return { status: 'not_configured', missingSeriesHashTables: [] };
  }
  if (isLoading) {
    return { status: 'loading', missingSeriesHashTables: [] };
  }
  if (!isSeriesValid) {
    return { status: 'invalid_series', missingSeriesHashTables: [] };
  }
  if (missingSeriesHashTables.length > 0) {
    return { status: 'missing_series_hash', missingSeriesHashTables };
  }
  return { status: 'ready', missingSeriesHashTables: [] };
}

/**
 * Whether a Metric source can use a series-table to accelerate queries:
 * the team flag is on, the source has a valid `series` table, and every
 * other registered metric table has a `SeriesHash UInt64` column so it can
 * be joined against `series`.
 */
export function useMetricsSeriesTableAvailability({
  metricTables,
  seriesTable,
  databaseName,
  connectionId,
}: {
  metricTables: Partial<Record<MetricsDataType, string>> | undefined;
  seriesTable: string | undefined;
  databaseName: string;
  connectionId: string;
}): MetricsSeriesTableAvailability {
  const { data: team } = api.useTeam();
  const isMetricsSeriesTableEnabled = !!team?.isMetricsSeriesTableEnabled;
  const metadata = useMetadataWithSettings();

  const canQuery =
    isMetricsSeriesTableEnabled && !!seriesTable && !!databaseName;

  const seriesValidQuery = useQuery({
    queryKey: [
      'metricsSeriesTable.seriesValid',
      connectionId,
      databaseName,
      seriesTable,
    ],
    queryFn: () =>
      isValidMetricTable({
        databaseName,
        tableName: seriesTable,
        connectionId,
        metricType: 'series',
        metadata,
      }),
    enabled: canQuery,
  });

  const registeredTables = Object.values(MetricsDataType).flatMap(
    metricType => {
      const tableName = metricTables?.[metricType];
      return tableName ? [{ metricType, tableName }] : [];
    },
  );

  const hashColumnQueries = useQueries({
    queries: registeredTables.map(({ tableName }) => ({
      queryKey: [
        'metricsSeriesTable.seriesHashColumn',
        connectionId,
        databaseName,
        tableName,
      ],
      queryFn: () =>
        metadata.getColumns({ databaseName, tableName, connectionId }),
      enabled: canQuery,
    })),
  });

  const isLoading =
    (canQuery && seriesValidQuery.isLoading) ||
    hashColumnQueries.some(q => q.isLoading);

  const missingSeriesHashTables = registeredTables
    .filter((_, i) => {
      const columns = hashColumnQueries[i]?.data;
      return columns != null && !hasSeriesHashColumn(columns);
    })
    .map(({ tableName }) => tableName);

  return computeMetricsSeriesTableAvailability({
    isMetricsSeriesTableEnabled,
    seriesTableName: seriesTable,
    isLoading,
    isSeriesValid: !!seriesValidQuery.data,
    missingSeriesHashTables,
  });
}
