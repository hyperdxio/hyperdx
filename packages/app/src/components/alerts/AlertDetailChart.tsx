import * as React from 'react';
import Link from 'next/link';
import { pick } from 'lodash';
import {
  Granularity,
  isTimeSeriesDisplayType,
} from '@hyperdx/common-utils/dist/core/utils';
import { getDashboardVariableDeclarations } from '@hyperdx/common-utils/dist/filters';
import {
  isPromqlSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  AlertSource,
  ChartConfigWithDateRange,
  ChartVariable,
  DisplayType,
  getSampleWeightExpression,
  isLogSource,
  isTraceSource,
  SavedChartConfig,
  SourceKind,
  TSource,
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

/**
 * Assemble a renderable chart config from a saved chart config (a dashboard
 * tile's, or an inline alert's persisted one) over the alert's window.
 * Mirrors the dashboard Tile's assembly, and is shared by the tile and inline
 * variants so the two previews cannot drift.
 *
 * Returns undefined when the config can't be charted here: PromQL (no alert
 * support), a raw SQL config that isn't a time series, or a source that
 * hasn't resolved.
 */
export function buildAlertChartConfig({
  savedConfig,
  source,
  variables,
  dateRange,
  granularity,
}: {
  /**
   * A dashboard tile's config, or an inline alert's persisted one — the
   * latter is the former minus the embedded `alert`, so both fit here.
   */
  savedConfig: SavedChartConfig | undefined;
  source: TSource | undefined;
  variables: ChartVariable[];
  dateRange: [Date, Date];
  granularity: Granularity;
}): ChartConfigWithDateRange | undefined {
  if (!savedConfig || isPromqlSavedChartConfig(savedConfig)) {
    return undefined;
  }

  // Raw SQL: only time-series display types can be charted over the alert
  // window. A raw SQL Number alert is a valid alert, but its query returns one
  // value per window rather than a series — see `isSingleValueRawSqlConfig`.
  if (isRawSqlSavedChartConfig(savedConfig)) {
    if (!isTimeSeriesDisplayType(savedConfig.displayType)) {
      return undefined;
    }
    if (!savedConfig.source) {
      return { ...savedConfig, dateRange, granularity, variables };
    }
    if (!source) {
      return undefined;
    }
    return {
      ...savedConfig,
      variables,
      ...pick(source, [
        'implicitColumnExpression',
        'useTextIndexForImplicitColumn',
        'from',
        'metricTables',
      ]),
      ...(isLogSource(source) ? { bodyExpression: source.bodyExpression } : {}),
      sampleWeightExpression: getSampleWeightExpression(source),
      dateRange,
      granularity,
    };
  }

  // Builder configs. Number tiles are rendered as a line chart here — the
  // alert task evaluates them as a time series, and the threshold-over-time
  // view is what matters.
  if (!source?.connection) {
    return undefined;
  }
  const isMetricSource = source.kind === SourceKind.Metric;
  const firstSelect = savedConfig.select[0];
  const metricType =
    isMetricSource && typeof firstSelect !== 'string'
      ? firstSelect?.metricType
      : undefined;
  const tableName = getMetricTableName(source, metricType);
  return {
    ...savedConfig,
    variables,
    displayType:
      savedConfig.displayType === DisplayType.Number
        ? DisplayType.Line
        : savedConfig.displayType,
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
}

/**
 * Whether the alert's query yields a single value per evaluation window rather
 * than a series, which is the case for a raw SQL chart on a non-time-series
 * display type — in practice Number, the only other display type raw SQL
 * alerts support.
 *
 * These are legitimate alerts, they just have no threshold-over-time chart to
 * draw: their SQL carries no interval parameter to bucket by, which is exactly
 * why the check-alerts task evaluates them as `single_value` (see
 * `getResponseMetadata`). Distinguished from an unsupported config so the
 * fallback can say why instead of reading as a defect.
 */
export function isSingleValueRawSqlConfig(
  config: SavedChartConfig | undefined,
): boolean {
  return (
    config != null &&
    isRawSqlSavedChartConfig(config) &&
    !isTimeSeriesDisplayType(config.displayType)
  );
}

const SINGLE_VALUE_RAW_SQL_MESSAGE =
  'This alert runs a raw SQL query that returns one value per window, so it has no chart over time.';

function useAlertReferenceLines(alert: AlertsPageItem) {
  return React.useMemo(
    () =>
      getAlertReferenceLines({
        threshold: alert.threshold,
        thresholdMax: alert.thresholdMax,
        thresholdType: alert.thresholdType,
      }),
    [alert.threshold, alert.thresholdMax, alert.thresholdType],
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
  const config = React.useMemo(
    () =>
      buildAlertChartConfig({
        savedConfig: tile?.config,
        source,
        // The alert (and its preview) runs with every dashboard variable in
        // its empty state.
        variables: getDashboardVariableDeclarations(dashboard?.filters).map(
          declaration => ({ ...declaration, values: [] }),
        ),
        dateRange,
        granularity,
      }),
    [tile, source, dashboard?.filters, dateRange, granularity],
  );

  const referenceLines = useAlertReferenceLines(alert);

  if (isDashboardsLoading || (tileSourceId != null && isSourceLoading)) {
    return <Skeleton h={CHART_HEIGHT} w="100%" />;
  }

  if (!config) {
    return (
      <ChartFallback
        alertUrl={alertUrl}
        message={
          isSingleValueRawSqlConfig(tile?.config)
            ? SINGLE_VALUE_RAW_SQL_MESSAGE
            : "This tile type can't be previewed here."
        }
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
 * An inline alert's chart, rendered from the config persisted on the alert
 * itself — no dashboard or saved search to resolve. Only the single-alert
 * response carries `chartConfig`, so a list-shaped alert falls through to the
 * "can't be previewed" message.
 */
function InlineAlertChart({
  alert,
  dateRange,
  alertUrl,
}: {
  alert: AlertsPageItem;
  dateRange: [Date, Date];
  alertUrl?: string;
}) {
  const annotations = useAlertAnnotations(alert._id, dateRange, true);
  const chartConfig = alert.chartConfig;
  const configSourceId = chartConfig?.source;
  const { data: source, isLoading: isSourceLoading } = useSource({
    id: configSourceId,
  });

  const granularity = intervalToGranularity(alert.interval);
  const config = React.useMemo(
    () =>
      buildAlertChartConfig({
        savedConfig: chartConfig,
        source,
        // Inline alerts have no dashboard, so no variables are in scope.
        variables: [],
        dateRange,
        granularity,
      }),
    [chartConfig, source, dateRange, granularity],
  );

  const referenceLines = useAlertReferenceLines(alert);

  if (configSourceId != null && isSourceLoading) {
    return <Skeleton h={CHART_HEIGHT} w="100%" />;
  }

  if (!config) {
    return (
      <ChartFallback
        alertUrl={alertUrl}
        message={
          isSingleValueRawSqlConfig(chartConfig)
            ? SINGLE_VALUE_RAW_SQL_MESSAGE
            : "This alert's chart can't be previewed here."
        }
      />
    );
  }

  return (
    <ChartShell>
      <DBTimeChart
        sourceId={configSourceId ?? undefined}
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
  if (alert.source === AlertSource.INLINE) {
    return (
      <InlineAlertChart
        alert={alert}
        dateRange={dateRange}
        alertUrl={alertUrl}
      />
    );
  }
  return (
    <ChartFallback
      alertUrl={alertUrl}
      message="This alert type can't be previewed here."
    />
  );
}
