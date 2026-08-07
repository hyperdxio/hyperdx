import { useEffect, useMemo, useRef } from 'react';
import {
  BuilderChartConfigWithDateRange,
  Filter,
  SearchConditionLanguage,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getFirstTimestampValueExpression } from '@/source';
import { getChartColorInfo } from '@/utils';

/**
 * Resource attribute carrying the running release. `service.version` is OTel
 * resource semconv, so this works out of the box for instrumented services.
 */
export const DEFAULT_VERSION_EXPRESSION =
  "ResourceAttributes['service.version']";

const DEPLOY_EMPTY_NOTIFICATION_ID = 'deployment-markers-empty';

/** Distinct versions fetched per window. Far above any real release cadence. */
const MAX_DEPLOY_ROWS = 500;

/**
 * Query bounds are floored/ceiled to this, so a live-tailing dashboard reuses
 * one cached result instead of issuing a fresh query every tick. Matches the
 * bucketing `api.useAlertHistory` applies for the same reason.
 */
const BUCKET_MS = 60_000;

// How far back before the visible window we look for the already-running
// version. See `deploymentRowsToAnnotations` for why.
const MIN_LOOKBACK_MS = 30 * 60_000;
const LOOKBACK_RATIO = 0.1;

/** A row of the deployments query. Values arrive as strings from ClickHouse. */
export type DeploymentRow = {
  firstSeen?: string | number | null;
  version?: string | null;
  service?: string | null;
};

/** Narrows the tile's filters to the ones worth sending. */
type DeploymentScope = {
  where?: string;
  whereLanguage?: SearchConditionLanguage;
  filters?: Filter[];
};

/**
 * Whether releases can be derived from this source.
 *
 * Only log and trace sources qualify: the deployments query runs against the
 * *same table* the tile charts, which is what makes the tile's own filters
 * meaningful against it. Metric sources resolve their table from `metricTables`
 * per metric type, so there is no single table to re-aggregate, and a tile
 * filter written against metric columns would not apply to a log table.
 */
export function canDeriveDeployments(
  source: TSource | undefined,
): source is TSource {
  return (
    source != null &&
    !source.disabled &&
    (source.kind === SourceKind.Log || source.kind === SourceKind.Trace)
  );
}

/**
 * The expression that yields a service's running release for this source.
 *
 * Falls back to the OpenTelemetry `service.version` resource attribute, which
 * covers teams following resource semconv. Teams whose version lives elsewhere
 * — a container image tag under GitOps, a custom attribute — set
 * `serviceVersionExpression` on the source instead of changing instrumentation.
 */
export function resolveVersionExpression(source: TSource | undefined): string {
  const configured =
    source != null && 'serviceVersionExpression' in source
      ? source.serviceVersionExpression
      : undefined;
  return configured?.trim() || DEFAULT_VERSION_EXPRESSION;
}

/**
 * Builds the "when did each release first appear" query: one row per version
 * (per service), carrying the earliest timestamp it was seen at.
 *
 * `scope` carries the tile's own predicates so the markers describe the slice
 * the chart is actually showing — a tile filtered to one service must not be
 * annotated with another service's releases.
 *
 * Uses string `select`/`groupBy` rather than the structured builder form. This
 * is a fixed one-off aggregate rather than a user-editable series, and
 * `SelectListSchema` accepts a raw string for exactly that case — which also
 * keeps `min()` over a `DateTime64` out of the aggregate-function machinery.
 */
export function buildDeploymentChartConfig(
  source: TSource,
  versionExpression: string,
  dateRange: [Date, Date],
  scope: DeploymentScope = {},
): BuilderChartConfigWithDateRange {
  const timestampExpression = getFirstTimestampValueExpression(
    source.timestampValueExpression,
  );
  const serviceExpression =
    'serviceNameExpression' in source
      ? source.serviceNameExpression
      : undefined;

  // The tile's own `where` and the dashboard filters both go through `filters`,
  // which carries a language per entry — the config's own `where` is reserved
  // for the SQL version predicate below.
  const scopeFilters: Filter[] = [
    ...(scope.where?.trim()
      ? [
          {
            type: scope.whereLanguage === 'sql' ? 'sql' : 'lucene',
            condition: scope.where,
          } as Filter,
        ]
      : []),
    ...(scope.filters ?? []).filter(
      filter => !('condition' in filter) || filter.condition?.trim(),
    ),
  ];

  return {
    connection: source.connection,
    source: source.id,
    from: source.from,
    timestampValueExpression: source.timestampValueExpression,
    // Needed for Lucene scope filters to resolve bare terms.
    implicitColumnExpression:
      'implicitColumnExpression' in source
        ? source.implicitColumnExpression
        : undefined,
    useTextIndexForImplicitColumn:
      'useTextIndexForImplicitColumn' in source
        ? source.useTextIndexForImplicitColumn
        : undefined,
    bodyExpression:
      'bodyExpression' in source ? source.bodyExpression : undefined,
    select: [
      `min(${timestampExpression}) AS firstSeen`,
      `${versionExpression} AS version`,
      ...(serviceExpression ? [`${serviceExpression} AS service`] : []),
    ].join(', '),
    where: `${versionExpression} != ''`,
    whereLanguage: 'sql',
    ...(scopeFilters.length ? { filters: scopeFilters } : {}),
    groupBy: [
      versionExpression,
      ...(serviceExpression ? [serviceExpression] : []),
    ].join(', '),
    // The group-by columns are already spelled out in `select`; without this
    // the renderer appends them a second time.
    selectGroupBy: false,
    orderBy: 'firstSeen ASC',
    limit: { limit: MAX_DEPLOY_ROWS },
    dateRange,
  };
}

/**
 * Placeholder so the hook can call `useQueriedChartConfig` unconditionally when
 * the tile's source can't provide releases. The query is disabled in that case
 * and never runs; the module-level identity keeps the query key stable.
 */
const NO_SOURCE_CONFIG: BuilderChartConfigWithDateRange = {
  connection: '',
  from: { databaseName: '', tableName: '' },
  select: '',
  where: '',
  whereLanguage: 'sql',
  timestampValueExpression: '',
  dateRange: [new Date(0), new Date(0)],
};

/**
 * Maps query rows to markers, keeping only versions whose first appearance
 * lands inside the visible window.
 *
 * The query range is widened backwards (see `useDeploymentAnnotations`) so the
 * version that was *already running* when the window opened also comes back —
 * its `min(timestamp)` would otherwise sit at the left edge and read as a
 * deploy that never happened. Anything first seen before `windowStart` is that
 * incumbent, so it is dropped.
 *
 * Residual artifact: a service idle for longer than the lookback has no rows in
 * the widened prefix, so its first post-idle row still reads as a deploy at the
 * left edge.
 */
export function deploymentRowsToAnnotations(
  rows: DeploymentRow[],
  { windowStart }: { windowStart: Date },
): ChartAnnotation[] {
  // Resolve the theme color once (it reads computed styles).
  const color = getChartColorInfo();
  const windowStartMs = windowStart.getTime();
  const annotations: ChartAnnotation[] = [];

  for (const row of rows) {
    if (row.firstSeen == null || !row.version) {
      continue;
    }
    const firstSeenMs = new Date(row.firstSeen).getTime();
    if (!Number.isFinite(firstSeenMs) || firstSeenMs < windowStartMs) {
      continue;
    }
    annotations.push({
      time: firstSeenMs,
      label: row.version,
      // Fallback only: the chart re-tints the marker to its service's series
      // color when that service is charted (see `getSeriesColorForGroup`).
      color,
      kind: 'deployment',
      groupNoun: 'deploys',
      group: row.service ?? undefined,
      key: `deploy-annotation-${firstSeenMs}-${row.version}-${row.service ?? ''}`,
    });
  }

  return annotations;
}

/**
 * Returns deployment markers for a tile, derived from changes in the
 * `service.version` resource attribute.
 *
 * Scoped to the tile: the query runs against the tile's own source with the
 * tile's own filters, so the markers describe the data the chart is showing. An
 * unfiltered tile spanning every service therefore does show every service's
 * releases — that is consistent, not noise.
 *
 * Returns annotation *data*; the chart renders it (clamping and label
 * collapsing need the chart's x-axis domain). The query stays idle unless
 * `enabled` is true and the source can provide releases.
 */
export function useDeploymentAnnotations(
  dateRange: [Date, Date],
  enabled: boolean = false,
  options?: DeploymentScope & {
    source?: TSource;
    /** Overrides the source's own expression. Mainly a testing seam. */
    versionExpression?: string;
  },
): ChartAnnotation[] | undefined {
  const source = options?.source;
  const isSupported = canDeriveDeployments(source);
  const versionExpression =
    options?.versionExpression ||
    resolveVersionExpression(isSupported ? source : undefined);

  // Quantize before memoizing so a sliding "last 15 minutes" window produces a
  // stable config for a whole minute.
  const windowStartMs =
    Math.floor(dateRange[0].getTime() / BUCKET_MS) * BUCKET_MS;
  const windowEndMs = Math.ceil(dateRange[1].getTime() / BUCKET_MS) * BUCKET_MS;

  // Callers rebuild the filter array every render, so key the memo on its
  // content. Tiles sharing a source and filters then share one query.
  const scopeKey = JSON.stringify({
    where: options?.where,
    whereLanguage: options?.whereLanguage,
    filters: options?.filters,
  });

  const config = useMemo(() => {
    if (!isSupported || !source) {
      return NO_SOURCE_CONFIG;
    }
    const lookbackMs = Math.max(
      MIN_LOOKBACK_MS,
      (windowEndMs - windowStartMs) * LOOKBACK_RATIO,
    );
    return buildDeploymentChartConfig(
      source,
      versionExpression,
      [new Date(windowStartMs - lookbackMs), new Date(windowEndMs)],
      JSON.parse(scopeKey),
    );
  }, [
    isSupported,
    source,
    versionExpression,
    windowStartMs,
    windowEndMs,
    scopeKey,
  ]);

  const { data, isFetching } = useQueriedChartConfig(config, {
    enabled: enabled && isSupported,
  });

  const annotations = useMemo(() => {
    if (!enabled || !data?.data?.length) {
      return undefined;
    }
    const mapped = deploymentRowsToAnnotations(data.data, {
      windowStart: new Date(windowStartMs),
    });
    return mapped.length ? mapped : undefined;
  }, [enabled, data, windowStartMs]);

  // Toggling markers on and seeing nothing reads as broken, and the common
  // cause is simply that the service does not emit `service.version`. Say so
  // once (Mantine dedupes concurrent tiles by notification id).
  const hasWarnedRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      hasWarnedRef.current = false;
      return;
    }
    if (isFetching || data == null || annotations != null) {
      return;
    }
    if (hasWarnedRef.current) {
      return;
    }
    hasWarnedRef.current = true;
    notifications.show({
      id: DEPLOY_EMPTY_NOTIFICATION_ID,
      color: 'yellow',
      title: 'No deployments found',
      message:
        'Deployment markers are derived from the OpenTelemetry `service.version` resource attribute. No version changes were found in this time range.',
    });
  }, [enabled, isFetching, data, annotations]);

  return annotations;
}
