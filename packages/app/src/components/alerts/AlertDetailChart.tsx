import * as React from 'react';
import Link from 'next/link';
import { pick } from 'lodash';
import { isTimeSeriesDisplayType } from '@hyperdx/common-utils/dist/core/utils';
import {
  isPromqlSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  AlertSource,
  ChartConfigWithDateRange,
  DisplayType,
  getSampleWeightExpression,
  isLogSource,
  isTraceSource,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Anchor, Center, Paper, Skeleton, Text } from '@mantine/core';

import { AlertPreviewChart } from '@/components/AlertPreviewChart';
import { getAlertReferenceLines } from '@/components/Alerts';
import { DBTimeChart } from '@/components/DBTimeChart';
import { useDashboards } from '@/dashboard';
import { useAlertAnnotations } from '@/hooks/useAlertAnnotations';
import { useSavedSearch } from '@/savedSearch';
import { useSource } from '@/source';
import type { AlertsPageItem } from '@/types';
import { getMetricTableName } from '@/utils';
import { intervalToGranularity } from '@/utils/alerts';

const CHART_HEIGHT = 280;

function ChartShell({ children }: { children: React.ReactNode }) {
  return (
    <Paper w="100%" h={CHART_HEIGHT}>
      {children}
    </Paper>
  );
}

function ChartFallback({
  alertUrl,
  message,
}: {
  alertUrl?: string;
  message: string;
}) {
  return (
    <ChartShell>
      <Center h="100%">
        <Text size="sm" c="dimmed">
          {message}
          {alertUrl && (
            <>
              {' '}
              <Anchor component={Link} href={alertUrl} size="sm">
                Open source
              </Anchor>
            </>
          )}
        </Text>
      </Center>
    </ChartShell>
  );
}

function SavedSearchAlertChart({
  alert,
  dateRange,
}: {
  alert: AlertsPageItem;
  dateRange: [Date, Date];
}) {
  const annotations = useAlertAnnotations(alert._id, dateRange, true);
  const { data: savedSearch, isLoading: isSavedSearchLoading } = useSavedSearch(
    { id: alert.savedSearchId ?? '' },
    { enabled: alert.savedSearchId != null },
  );
  const { data: source, isLoading: isSourceLoading } = useSource({
    id: savedSearch?.source,
  });

  if (isSavedSearchLoading || (savedSearch != null && isSourceLoading)) {
    return <Skeleton h={CHART_HEIGHT} w="100%" />;
  }

  if (!savedSearch || !source) {
    return (
      <ChartFallback message="Unable to load the saved search behind this alert." />
    );
  }

  return (
    <AlertPreviewChart
      source={source}
      where={savedSearch.where}
      whereLanguage={savedSearch.whereLanguage}
      filters={savedSearch.filters}
      interval={alert.interval}
      groupBy={alert.groupBy}
      threshold={alert.threshold}
      thresholdMax={alert.thresholdMax}
      thresholdType={alert.thresholdType}
      select={savedSearch.select}
      dateRange={dateRange}
      annotations={annotations}
      height={CHART_HEIGHT}
    />
  );
}

function TileAlertChart({
  alert,
  dateRange,
  alertUrl,
}: {
  alert: AlertsPageItem;
  dateRange: [Date, Date];
  alertUrl?: string;
}) {
  const annotations = useAlertAnnotations(alert._id, dateRange, true);
  const { data: dashboards, isLoading: isDashboardsLoading } = useDashboards();
  const dashboard = dashboards?.find(d => d.id === alert.dashboardId);
  const tile = dashboard?.tiles?.find(t => t.id === alert.tileId);

  const tileSourceId =
    tile != null && !isPromqlSavedChartConfig(tile.config)
      ? tile.config.source
      : undefined;
  const { data: source, isLoading: isSourceLoading } = useSource({
    id: tileSourceId,
  });

  const granularity = intervalToGranularity(alert.interval);
  const config = React.useMemo<ChartConfigWithDateRange | undefined>(() => {
    if (!tile || isPromqlSavedChartConfig(tile.config)) {
      return undefined;
    }

    // Raw SQL tiles: only time-series display types can be charted over the
    // alert window (mirrors what the alert task evaluates as a time series).
    if (isRawSqlSavedChartConfig(tile.config)) {
      if (!isTimeSeriesDisplayType(tile.config.displayType)) {
        return undefined;
      }
      if (!tile.config.source) {
        return { ...tile.config, dateRange, granularity };
      }
      if (!source) {
        return undefined;
      }
      return {
        ...tile.config,
        ...pick(source, [
          'implicitColumnExpression',
          'useTextIndexForImplicitColumn',
          'from',
          'metricTables',
        ]),
        ...(isLogSource(source)
          ? { bodyExpression: source.bodyExpression }
          : {}),
        sampleWeightExpression: getSampleWeightExpression(source),
        dateRange,
        granularity,
      };
    }

    // Builder tiles (mirrors the dashboard Tile's config assembly). Number
    // tiles are rendered as a line chart here — the alert task evaluates them
    // as a time series, and the threshold-over-time view is what matters.
    if (!source?.connection) {
      return undefined;
    }
    const isMetricSource = source.kind === SourceKind.Metric;
    const firstSelect = tile.config.select[0];
    const metricType =
      isMetricSource && typeof firstSelect !== 'string'
        ? firstSelect?.metricType
        : undefined;
    const tableName = getMetricTableName(source, metricType);
    return {
      ...tile.config,
      displayType:
        tile.config.displayType === DisplayType.Number
          ? DisplayType.Line
          : tile.config.displayType,
      connection: source.connection,
      dateRange,
      granularity,
      timestampValueExpression: source.timestampValueExpression,
      from: {
        databaseName: source.from?.databaseName || 'default',
        tableName: tableName || '',
      },
      implicitColumnExpression:
        isLogSource(source) || isTraceSource(source)
          ? source.implicitColumnExpression
          : undefined,
      useTextIndexForImplicitColumn:
        isLogSource(source) || isTraceSource(source)
          ? source.useTextIndexForImplicitColumn
          : undefined,
      bodyExpression: isLogSource(source) ? source.bodyExpression : undefined,
      sampleWeightExpression: getSampleWeightExpression(source),
      metricTables: isMetricSource ? source.metricTables : undefined,
    };
  }, [tile, source, dateRange, granularity]);

  const referenceLines = React.useMemo(
    () =>
      getAlertReferenceLines({
        threshold: alert.threshold,
        thresholdMax: alert.thresholdMax,
        thresholdType: alert.thresholdType,
      }),
    [alert.threshold, alert.thresholdMax, alert.thresholdType],
  );

  if (isDashboardsLoading || (tileSourceId != null && isSourceLoading)) {
    return <Skeleton h={CHART_HEIGHT} w="100%" />;
  }

  if (!config) {
    return (
      <ChartFallback
        alertUrl={alertUrl}
        message="This tile type can't be previewed here."
      />
    );
  }

  return (
    <ChartShell>
      <DBTimeChart
        sourceId={tileSourceId ?? undefined}
        showDisplaySwitcher={false}
        showMVOptimizationIndicator={false}
        showDateRangeIndicator={false}
        referenceLines={referenceLines}
        annotations={annotations}
        config={config}
      />
    </ChartShell>
  );
}

/**
 * The alert's underlying query charted over the selected time range, with
 * threshold reference lines and firing/recovery annotations.
 */
export function AlertDetailChart({
  alert,
  dateRange,
  alertUrl,
}: {
  alert: AlertsPageItem;
  dateRange: [Date, Date];
  alertUrl?: string;
}) {
  if (alert.source === AlertSource.SAVED_SEARCH) {
    return <SavedSearchAlertChart alert={alert} dateRange={dateRange} />;
  }
  if (alert.source === AlertSource.TILE) {
    return (
      <TileAlertChart alert={alert} dateRange={dateRange} alertUrl={alertUrl} />
    );
  }
  return (
    <ChartFallback
      alertUrl={alertUrl}
      message="This alert type can't be previewed here."
    />
  );
}
