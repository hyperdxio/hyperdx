import { ChSql, chSql } from '@/clickhouse';
import { BuilderChartConfig } from '@/types';

/**
 * SQL (CTE) builders for the OTel metrics v2 schema — the series/points split
 * layout written by the ClickHouse exporter's `metrics_schema: v2` mode.
 *
 * Query shape (see METRICS_V2 cookbook):
 *   1. Resolve series on the (text-indexed) series table, bounded by Date.
 *      Label matchers / user filters apply here. The CTE GROUP BYs SeriesHash
 *      so it yields exactly one row per series (collapsing per-day rows).
 *   2. Range-scan the points table on (MetricName, SeriesHash, TimeUnix),
 *      always bounded by TimeUnix, restricted with SeriesHash IN (series CTE).
 *   3. Aggregate points per (SeriesHash, time bucket) BEFORE joining labels,
 *      then INNER JOIN back to the series CTE for label/groupBy columns.
 *      Plain INNER JOIN (not ANY): the series CTE is already deduped, and
 *      ANY INNER JOIN collapses left-side rows to one per key.
 *   4. Counter semantics branch on the series table's Temporality. Since
 *      temporality isn't known during the per-point pass, both the delta and
 *      cumulative variants are computed and the correct one is chosen after
 *      the label join.
 */

type WithClauses = NonNullable<BuilderChartConfig['with']>;
type TemplatedInput = ChSql | string;

/**
 * Resolve narrow, hydrate late: series resolution cost is linear in matched
 * series, and the attribute maps are the fattest columns in the schema, so
 * the Series CTE projects ONLY what the query's math and group-by actually
 * reference (measured ~12s of resolution on a 2.7M-series metric when every
 * map was dragged through the aggregation). Full label maps are never needed
 * by current panels — legends are driven by the group-by values — so no
 * hydration join exists; if a per-series legend panel ever ships, hydrate
 * the ≤N displayed winners with one small SeriesHash IN (...) join instead
 * of widening this CTE.
 */
export type SeriesNeeds = {
  /** Query branches on s.Temporality (counters / histogram-family). */
  temporality?: boolean;
  /** Sum path also branches on s.IsMonotonic. */
  monotonicity?: boolean;
  /** Explicit-histogram quantile math (bounds are series identity). */
  explicitBounds?: boolean;
  /** Summary quantile math. */
  quantiles?: boolean;
  /** Histogram quantile merge tail groups by s.MetricName. */
  metricName?: boolean;
  /** Bare series columns referenced by group-by/where expressions. */
  bareColumns?: string[];
  /** Map keys referenced per attribute map — projected as mini-maps
   * (`map('k', any(M['k'])) AS M`) so downstream `M['k']` expressions keep
   * working while resolution extracts exactly one value per key. Keys are
   * stored as the verbatim quoted SQL literals. */
  mapKeys?: Record<string, string[]>;
  /** Whole-map references (rare) — fall back to projecting the full map. */
  fullMaps?: string[];
};

const SERIES_MAP_COLUMNS = [
  'ResourceAttributes',
  'ScopeAttributes',
  'Attributes',
] as const;

/** Bare series columns downstream expressions may reference, with their
 * resolution projections (aliased to v1-compat names where they differ). */
const SERIES_BARE_COLUMN_SELECT: Record<string, string> = {
  ServiceName: 'any(ServiceName) AS ServiceName',
  MetricName: 'any(MetricName) AS MetricName',
  MetricType: 'any(MetricType) AS MetricType',
  ScopeName: 'any(ScopeName) AS ScopeName',
  ScopeVersion: 'any(ScopeVersion) AS ScopeVersion',
  ResourceSchemaUrl: 'any(ResourceSchemaUrl) AS ResourceSchemaUrl',
  ScopeSchemaUrl: 'any(ScopeSchemaUrl) AS ScopeSchemaUrl',
  MetricUnit: 'any(Unit) AS MetricUnit',
  MetricDescription: `'' AS MetricDescription`,
  Temporality: 'any(Temporality) AS Temporality',
  IsMonotonic: 'any(IsMonotonic) AS IsMonotonic',
};

/**
 * Parses group-by (or any outer) expression text for the series columns it
 * references: map-key accesses become mini-map projections, bare column
 * tokens become single-column projections, keyless map references fall back
 * to the full map.
 */
export const parseSeriesNeeds = (
  expressionTexts: Array<string | undefined>,
  base: SeriesNeeds = {},
): SeriesNeeds => {
  const text = expressionTexts.filter(Boolean).join('\n');
  const mapKeys: Record<string, string[]> = {};
  const keyedRe =
    /\b(ResourceAttributes|ScopeAttributes|Attributes)\s*\[\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = keyedRe.exec(text)) !== null) {
    const keys = (mapKeys[m[1]] ??= []);
    if (!keys.includes(m[2])) keys.push(m[2]);
  }
  const withoutKeyed = text.replace(keyedRe, '');
  const fullMaps = SERIES_MAP_COLUMNS.filter(col =>
    new RegExp(`\\b${col}\\b`).test(withoutKeyed),
  );
  const bareColumns = Object.keys(SERIES_BARE_COLUMN_SELECT).filter(col =>
    new RegExp(`\\b${col}\\b`).test(text),
  );
  return { ...base, bareColumns, mapKeys, fullMaps };
};

/** Source columns each projectable alias reads (MetricDescription is a
 * literal — no source column). */
const SERIES_BARE_COLUMN_SOURCE: Record<string, string | null> = {
  ServiceName: 'ServiceName',
  MetricName: 'MetricName',
  MetricType: 'MetricType',
  ScopeName: 'ScopeName',
  ScopeVersion: 'ScopeVersion',
  ResourceSchemaUrl: 'ResourceSchemaUrl',
  ScopeSchemaUrl: 'ScopeSchemaUrl',
  MetricUnit: 'Unit',
  MetricDescription: null,
  Temporality: 'Temporality',
  IsMonotonic: 'IsMonotonic',
};

/** The physical columns the resolution subquery must read. ClickHouse does
 * not reliably prune unused columns through the inner `SELECT *`, and the
 * attribute maps are the fattest columns in the schema — so the inner
 * select list is derived from `needs` too (WHERE may reference any table
 * column regardless of the select list). */
const seriesInnerColumns = (needs: SeriesNeeds): string => {
  const cols = new Set<string>(['SeriesHash']);
  if (needs.temporality) cols.add('Temporality');
  if (needs.monotonicity) cols.add('IsMonotonic');
  if (needs.metricName) cols.add('MetricName');
  if (needs.explicitBounds) cols.add('ExplicitBounds');
  if (needs.quantiles) cols.add('Quantiles');
  for (const col of needs.bareColumns ?? []) {
    const src = SERIES_BARE_COLUMN_SOURCE[col];
    if (src) cols.add(src);
  }
  for (const mapCol of needs.fullMaps ?? []) cols.add(mapCol);
  for (const mapCol of Object.keys(needs.mapKeys ?? {})) cols.add(mapCol);
  return [...cols].join(', ');
};

/** Comma-prefixed projection list for the Series CTE. */
const seriesNeedsSelect = (needs: SeriesNeeds): string => {
  const aliases = new Set<string>();
  const parts: string[] = [];
  const add = (alias: string, expr: string) => {
    if (aliases.has(alias)) return;
    aliases.add(alias);
    parts.push(expr);
  };
  if (needs.temporality) add('Temporality', 'any(Temporality) AS Temporality');
  if (needs.monotonicity) add('IsMonotonic', 'any(IsMonotonic) AS IsMonotonic');
  if (needs.metricName) add('MetricName', 'any(MetricName) AS MetricName');
  if (needs.explicitBounds)
    add('ExplicitBounds', 'any(ExplicitBounds) AS ExplicitBounds');
  if (needs.quantiles) add('Quantiles', 'any(Quantiles) AS Quantiles');
  for (const col of needs.bareColumns ?? []) {
    const expr = SERIES_BARE_COLUMN_SELECT[col];
    if (expr) add(col, expr);
  }
  for (const mapCol of needs.fullMaps ?? []) {
    add(mapCol, `any(${mapCol}) AS ${mapCol}`);
  }
  for (const [mapCol, keys] of Object.entries(needs.mapKeys ?? {})) {
    if (aliases.has(mapCol)) continue; // full map already projected
    const entries = keys.map(k => `${k}, any(${mapCol}[${k}])`).join(', ');
    add(mapCol, `map(${entries}) AS ${mapCol}`);
  }
  return parts.length ? `,\n      ${parts.join(',\n      ')}` : '';
};

/** Comma-prefixed label re-projection off the joined series CTE (`s`) —
 * only the columns the outer query can reference (group-by tokens). */
const joinedNeedsSelect = (needs: SeriesNeeds): string => {
  const cols = new Set<string>([
    ...(needs.bareColumns ?? []),
    ...(needs.fullMaps ?? []),
    ...Object.keys(needs.mapKeys ?? {}),
  ]);
  return cols.size
    ? `,${[...cols].map(c => `\n        s.${c} AS ${c}`).join(',')}`
    : '';
};

/** Phase 1: resolve matching series (one row per SeriesHash), projecting
 * only the columns in `needs`. */
export const seriesCteV2 = ({
  seriesFrom,
  seriesWhere,
  needs,
}: {
  seriesFrom: TemplatedInput;
  seriesWhere: TemplatedInput;
  needs: SeriesNeeds;
}): WithClauses[number] => ({
  name: 'Series',
  // The WHERE is applied in an inner subquery: several outer aggregates are
  // aliased to their source column name (any(MetricName) AS MetricName, ...),
  // and ClickHouse resolves WHERE identifiers against SELECT aliases first,
  // which would turn plain column filters into illegal aggregate references.
  sql: chSql`
    SELECT
      SeriesHash${seriesNeedsSelect(needs)}
    FROM (
      SELECT ${seriesInnerColumns(needs)}
      FROM ${seriesFrom}
      WHERE ${seriesWhere}
    )
    GROUP BY SeriesHash
  `,
});

const SERIES_HASH_FILTER = `SeriesHash IN (SELECT SeriesHash FROM Series)`;

/**
 * Whole-metric fast path: when a panel aggregates an entire metric (no
 * label filters, no group-by), the points/rollup tables' primary key
 * (MetricName, SeriesHash, Time*) makes `MetricName = '...'` alone a PK
 * scan — the `SeriesHash IN (Series)` subquery adds nothing but the cost of
 * resolving millions of hashes, so the Series CTE and the label join are
 * skipped entirely. Per-series math still groups by the points table's own
 * SeriesHash; temporality/monotonicity are resolved at generation time from
 * the series profile (a one-row narrow read) instead of the join.
 * Explicit-histogram and summary quantiles never take this path (they need
 * ExplicitBounds/Quantiles — series identity).
 */
const seriesScanFilter = (fast: unknown) =>
  fast ? '' : ` AND ${SERIES_HASH_FILTER}`;

/**
 * Rule 6 (staleness markers): OTLP FLAG_NO_RECORDED_VALUE is DataPointFlags
 * bit 0 — the OTel equivalent of a Prometheus staleness marker, emitted when
 * a scrape target disappears. A marker row's Value/Count/Sum/bucket fields
 * are meaningless zeros, so every raw-points value read must exclude them.
 * The filter belongs inside the dedup subquery's WHERE (before the
 * per-(series, ts) GROUP BY) so a marker sharing a timestamp with a real
 * duplicate can never win the max() or inflate the sum(). Rollup tiers have
 * no Flags column (markers are excluded at MV time); the series table is
 * never filtered (a series that ended with a marker was still legitimately
 * present that day).
 */
const NOT_STALENESS_MARKER = `bitAnd(Flags, 1) = 0`;

/**
 * Gauge: aggregate the float points per (series, bucket), then join labels.
 * Final CTE is named `Metrics`; exposes LastValue + label columns.
 */
export const gaugeCtesV2 = ({
  fast,
  needs,
  pointsFrom,
  pointsWhere,
  timeExpr,
  timeBucketCol,
  bucketValueExpr,
  dropStaleBuckets,
}: {
  fast?: boolean;
  needs: SeriesNeeds;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  timeExpr: TemplatedInput;
  timeBucketCol: string;
  bucketValueExpr: string;
  /** Prometheus staleness semantics for last-value shapes: when a series'
   * newest point in a bucket is a staleness marker, the series is gone —
   * drop its row instead of holding the last real value. Only valid when
   * `bucketValueExpr` is the argMax last-value pick (not the isDelta path,
   * which consumes every deduped row and needs markers filtered out
   * entirely). */
  dropStaleBuckets: boolean;
}): WithClauses => [
  {
    // Same-timestamp duplicates collapse to max(Value) per (series, ts)
    // before the per-bucket pick — deterministic instead of an argMax tie.
    // Marker rows are excluded from the value pick (maxIf / Rule-6 WHERE);
    // in the staleness-aware variant a timestamp where ALL rows are markers
    // survives dedup (TsIsMarker=1, ValueMax defaults to 0 but can only be
    // picked if newest — and then the HAVING drops the whole bucket row).
    name: 'Bucketed',
    sql: dropStaleBuckets
      ? chSql`
      SELECT
        ${timeExpr},
        SeriesHash AS AttributesHash,
        ${bucketValueExpr} AS LastValue
      FROM (
        SELECT
          MetricName,
          SeriesHash,
          TimeUnix,
          maxIf(Value, ${NOT_STALENESS_MARKER}) AS ValueMax,
          min(bitAnd(Flags, 1)) AS TsIsMarker
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)}
        GROUP BY MetricName, SeriesHash, TimeUnix
      )
      GROUP BY SeriesHash, \`${timeBucketCol}\`
      HAVING argMax(TsIsMarker, TimeUnix) = 0
    `
      : chSql`
      SELECT
        ${timeExpr},
        SeriesHash AS AttributesHash,
        ${bucketValueExpr} AS LastValue
      FROM (
        SELECT MetricName, SeriesHash, TimeUnix, max(Value) AS ValueMax
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
        GROUP BY MetricName, SeriesHash, TimeUnix
      )
      GROUP BY SeriesHash, \`${timeBucketCol}\`
    `,
  },
  {
    name: 'Metrics',
    sql: chSql`
      SELECT
        b.\`${timeBucketCol}\` AS \`${timeBucketCol}\`,
        b.AttributesHash AS AttributesHash,
        b.LastValue AS LastValue${fast ? '' : joinedNeedsSelect(needs)}
      FROM Bucketed AS b${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON b.AttributesHash = s.SeriesHash`
      }
    `,
  },
];

/**
 * Sum (counter): per-point window pass computes both the cumulative-counter
 * increase (reset-clamped lag diff) and the delta running total; per-bucket
 * aggregation reduces to one row per (series, bucket); the label join picks
 * the right variant via Temporality. Final CTE is named `Bucketed` and
 * exposes Increase (per display bucket) / Rate (per SECOND — Increase over
 * the display bucket width, so readings are invariant across lookback
 * changes and tier routing) / Sum + label columns.
 */
export const sumCtesV2 = ({
  fast,
  resolved,
  needs,
  pointsFrom,
  pointsWhere,
  timeExpr,
  timeBucketCol,
  rateDivisor,
}: {
  fast?: { temporality: 'delta' | 'cumulative'; isMonotonic?: boolean };
  /** Temporality/monotonicity resolved from the series profile WITHOUT the
   * fast path (filters/group-by present): the label join stays, but the
   * dead temporality variant is not emitted — the delta running sum is a
   * full second window pass discarded on every cumulative panel. */
  resolved?: { temporality?: 'delta' | 'cumulative'; isMonotonic?: boolean };
  needs: SeriesNeeds;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  timeExpr: TemplatedInput;
  timeBucketCol: string;
  /** DISPLAY bucket width in seconds as a SQL expression — a resolved
   * constant, or `$__interval_s` in template mode. */
  rateDivisor: string;
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const isMonotonic = fast != null ? fast.isMonotonic : resolved?.isMonotonic;
  const needCum = temporality !== 'delta';
  const needCumMono = needCum && isMonotonic !== false;
  const needCumNonMono = needCum && isMonotonic !== true;
  const needDelta = temporality !== 'cumulative';
  const rateExpr =
    temporality === 'delta'
      ? 'b.RateIfDelta'
      : temporality === 'cumulative'
        ? isMonotonic === true
          ? 'b.RateIfCumulative'
          : isMonotonic === false
            ? 'b.RateIfCumulativeNonMonotonic'
            : `IF(s.IsMonotonic, b.RateIfCumulative, b.RateIfCumulativeNonMonotonic)`
        : `multiIf(
          s.Temporality = 'delta', b.RateIfDelta,
          s.IsMonotonic, b.RateIfCumulative,
          b.RateIfCumulativeNonMonotonic
        )`;
  const sumExpr =
    temporality === 'delta'
      ? 'b.SumIfDelta'
      : temporality === 'cumulative'
        ? 'b.SumIfCumulative'
        : `IF(s.Temporality = 'delta', b.SumIfDelta, b.SumIfCumulative)`;
  return [
    {
      // Same-timestamp duplicates are collapsed per (series, ts) BEFORE any
      // window function: a lower-valued duplicate would otherwise look like a
      // counter reset and the reset branch would re-add the full value.
      // Cumulative reads take max(Value) (the true counter sample); delta
      // reads take sum(Value) (duplicates are additive contributions). With
      // no duplicates max == sum == the single value, so results are
      // unchanged. The GROUP BY streams in primary-key order
      // (MetricName, SeriesHash, TimeUnix).
      //
      // On the first row of each series partition lagInFrame returns NULL and
      // the row contributes nothing to the bucket-level sum(). Monotonic
      // counter resets use Prometheus semantics per the v2 cookbook
      // (§5.8/§5.9): a decrease means the counter restarted, so the full
      // post-reset value counts as the increase (rather than v1's clamp-to-0).
      // Non-monotonic cumulative sums (UpDownCounters) legitimately decrease,
      // so their rate is the plain (possibly negative) difference.
      name: 'Source',
      sql: chSql`
      SELECT
        *,
        SeriesHash AS AttributesHash${
          needCum
            ? `,
        lagInFrame(toNullable(ValueMax), 1, NULL) OVER (PARTITION BY SeriesHash ORDER BY TimeUnix) AS PrevValue`
            : ''
        }${
          needCumMono
            ? `,
        multiIf(
          PrevValue IS NULL, NULL,
          ValueMax >= PrevValue, ValueMax - PrevValue,
          ValueMax
        ) AS RateIfCumulative`
            : ''
        }${
          needCumNonMono
            ? `,
        ValueMax - PrevValue AS RateIfCumulativeNonMonotonic`
            : ''
        }${
          needDelta
            ? `,
        sum(ValueSum) OVER (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS SumIfDelta`
            : ''
        }
      FROM (
        SELECT
          MetricName,
          SeriesHash,
          TimeUnix,
          max(Value) AS ValueMax,
          sum(Value) AS ValueSum
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
        GROUP BY MetricName, SeriesHash, TimeUnix
      )
    `,
    },
    {
      name: 'Bucketed',
      sql: chSql`
      SELECT
        b.\`${timeBucketCol}\` AS \`${timeBucketCol}\`,
        b.AttributesHash AS AttributesHash,
        ${rateExpr} AS Increase,
        ${'' /* per-second normalization: dividing per series (before any cross-series fn) makes avg/max/min operate on true per-series rates */}
        Increase / ${rateDivisor} AS Rate,
        ${sumExpr} AS Sum${fast ? '' : joinedNeedsSelect(needs)}
      FROM (
        SELECT
          ${timeExpr},
          AttributesHash${
            needCumMono
              ? `,
          sum(RateIfCumulative) AS RateIfCumulative`
              : ''
          }${
            needCumNonMono
              ? `,
          sum(RateIfCumulativeNonMonotonic) AS RateIfCumulativeNonMonotonic`
              : ''
          }${
            needDelta
              ? `,
          sum(ValueSum) AS RateIfDelta,
          argMax(SumIfDelta, TimeUnix) AS SumIfDelta`
              : ''
          }${
            needCum
              ? `,
          argMax(ValueMax, TimeUnix) AS SumIfCumulative`
              : ''
          }
        FROM Source
        GROUP BY AttributesHash, \`${timeBucketCol}\`
      ) AS b${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON b.AttributesHash = s.SeriesHash`
      }
    `,
    },
  ];
};

/**
 * Gauge over a rollup tier (5m/1h AggregatingMergeTree): per-series last
 * value in each display bucket via argMaxMerge(Last) — identical semantics
 * to last_value(Value) on raw points. `timeExpr` must bucket the tier's
 * TimeBucket column.
 */
export const gaugeRollupCtesV2 = ({
  fast,
  needs,
  rollupFrom,
  rollupWhere,
  timeExpr,
  timeBucketCol,
}: {
  fast?: boolean;
  needs: SeriesNeeds;
  rollupFrom: TemplatedInput;
  rollupWhere: TemplatedInput;
  timeExpr: TemplatedInput;
  timeBucketCol: string;
}): WithClauses => [
  {
    name: 'Bucketed',
    sql: chSql`
      SELECT
        ${timeExpr},
        SeriesHash AS AttributesHash,
        argMaxMerge(Last) AS LastValue
      FROM ${rollupFrom}
      WHERE ${rollupWhere}${seriesScanFilter(fast)}
      GROUP BY SeriesHash, \`${timeBucketCol}\`
    `,
  },
  {
    name: 'Metrics',
    sql: chSql`
      SELECT
        b.\`${timeBucketCol}\` AS \`${timeBucketCol}\`,
        b.AttributesHash AS AttributesHash,
        b.LastValue AS LastValue${fast ? '' : joinedNeedsSelect(needs)}
      FROM Bucketed AS b${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON b.AttributesHash = s.SeriesHash`
      }
    `,
  },
];

/**
 * Sum (counter) over a rollup tier — the cookbook §5.8 chained-increase
 * shape: per tier bucket take (First, Last) via argMin/argMaxMerge, chain
 * buckets per series with reset detection (a drop between buckets means the
 * counter restarted: count F fully), then re-bucket to the display
 * granularity. For delta temporality the rollup Sum column is exact.
 */
export const sumRollupCtesV2 = ({
  fast,
  resolved,
  needs,
  rollupFrom,
  rollupWhere,
  timeExpr,
  timeBucketCol,
  rateDivisor,
}: {
  fast?: { temporality: 'delta' | 'cumulative'; isMonotonic?: boolean };
  /** Resolved-but-not-fast: keep the label join, drop the dead temporality
   * variant (the delta running sum is a second window pass). */
  resolved?: { temporality?: 'delta' | 'cumulative'; isMonotonic?: boolean };
  needs: SeriesNeeds;
  rollupFrom: TemplatedInput;
  rollupWhere: TemplatedInput;
  timeExpr: TemplatedInput;
  timeBucketCol: string;
  /** DISPLAY bucket width in seconds as a SQL expression — a resolved
   * constant (never the tier width, or tier routing would step-change the
   * magnitude), or `$__interval_s` in template mode. */
  rateDivisor: string;
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const isMonotonic = fast != null ? fast.isMonotonic : resolved?.isMonotonic;
  const needCum = temporality !== 'delta';
  const needCumMono = needCum && isMonotonic !== false;
  const needCumNonMono = needCum && isMonotonic !== true;
  const needDelta = temporality !== 'cumulative';
  const rateExpr =
    temporality === 'delta'
      ? 'b.RateIfDelta'
      : temporality === 'cumulative'
        ? isMonotonic === true
          ? 'b.RateIfCumulative'
          : isMonotonic === false
            ? 'b.RateIfCumulativeNonMonotonic'
            : `IF(s.IsMonotonic, b.RateIfCumulative, b.RateIfCumulativeNonMonotonic)`
        : `multiIf(
          s.Temporality = 'delta', b.RateIfDelta,
          s.IsMonotonic, b.RateIfCumulative,
          b.RateIfCumulativeNonMonotonic
        )`;
  const sumExpr =
    temporality === 'delta'
      ? 'b.SumIfDelta'
      : temporality === 'cumulative'
        ? 'b.SumIfCumulative'
        : `IF(s.Temporality = 'delta', b.SumIfDelta, b.SumIfCumulative)`;
  return [
    {
      name: 'Source',
      sql: chSql`
      SELECT
        SeriesHash AS AttributesHash,
        TimeBucket,
        argMinMerge(First) AS F,
        argMaxMerge(Last) AS L,
        sum(Sum) AS SumAgg
      FROM ${rollupFrom}
      WHERE ${rollupWhere}${seriesScanFilter(fast)}
      GROUP BY SeriesHash, TimeBucket
    `,
    },
    {
      name: 'Chained',
      sql: chSql`
      SELECT
        *${
          needCum
            ? `,
        any(toNullable(L)) OVER (
          PARTITION BY AttributesHash
          ORDER BY TimeBucket
          ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING
        ) AS prevL`
            : ''
        }${
          needCumMono
            ? `,
        ${'' /* cross-bucket part (reset between buckets: count F fully) + within-bucket part (reset inside the bucket: count L fully — refines the cookbook §5.8 formula, which under-counts/negates mid-bucket resets per §7.1) */}
        IF(prevL IS NULL, 0, IF(F >= prevL, F - prevL, F)) + IF(L >= F, L - F, L) AS IncIfCumulative`
            : ''
        }${
          needCumNonMono
            ? `,
        IF(prevL IS NULL, L - F, L - prevL) AS IncIfCumulativeNonMonotonic`
            : ''
        }${
          needDelta
            ? `,
        sum(SumAgg) OVER (
          PARTITION BY AttributesHash
          ORDER BY TimeBucket
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS RunningSumIfDelta`
            : ''
        }
      FROM Source
    `,
    },
    {
      name: 'Bucketed',
      sql: chSql`
      SELECT
        b.\`${timeBucketCol}\` AS \`${timeBucketCol}\`,
        b.AttributesHash AS AttributesHash,
        ${rateExpr} AS Increase,
        ${'' /* per-second normalization: dividing per series (before any cross-series fn) makes avg/max/min operate on true per-series rates */}
        Increase / ${rateDivisor} AS Rate,
        ${sumExpr} AS Sum${fast ? '' : joinedNeedsSelect(needs)}
      FROM (
        SELECT
          ${timeExpr},
          AttributesHash${
            needCumMono
              ? `,
          sum(IncIfCumulative) AS RateIfCumulative`
              : ''
          }${
            needCumNonMono
              ? `,
          sum(IncIfCumulativeNonMonotonic) AS RateIfCumulativeNonMonotonic`
              : ''
          }${
            needDelta
              ? `,
          sum(SumAgg) AS RateIfDelta,
          argMax(RunningSumIfDelta, TimeBucket) AS SumIfDelta`
              : ''
          }${
            needCum
              ? `,
          argMax(L, TimeBucket) AS SumIfCumulative`
              : ''
          }
        FROM Chained
        GROUP BY AttributesHash, \`${timeBucketCol}\`
      ) AS b${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON b.AttributesHash = s.SeriesHash`
      }
    `,
    },
  ];
};

export const translateHistogramV2 = ({
  select,
  fast,
  resolved,
  ...rest
}: {
  select: Exclude<BuilderChartConfig['select'], string>[number];
  /** Whole-metric fast path (no filters/group-by): temporality resolved
   * at generation time; joinless single-branch shapes. */
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: label join stays, dead temporality variant is
   * not emitted. */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level == null)
      throw new Error('quantile must have a level');
    return histogramQuantileCtesV2({
      ...rest,
      level: select.level,
      resolved,
    });
  }
  if (select.aggFn === 'count') {
    return histogramCountCtesV2({ ...rest, fast, resolved });
  }
  if (select.aggFn === 'avg') {
    return histogramAvgCtesV2({ ...rest, fast, resolved });
  }
  throw new Error(`${select.aggFn} is not supported for histograms currently`);
};

/**
 * Explicit-bounds histogram over a rollup tier (5m/1h). Quantiles follow the
 * histogram-rollups spec: delta → sumForEachMerge(SumBuckets) is the exact
 * per-le window increase; cumulative → per-le First/Last chaining across tier
 * buckets. Count/avg use the scalar First/Last(Count|Sum) chains. Exponential
 * histograms have no rollup tiers — never route them here.
 */
export const translateHistogramRollupV2 = ({
  select,
  fast,
  resolved,
  ...rest
}: {
  select: Exclude<BuilderChartConfig['select'], string>[number];
  /** Whole-metric fast path (no filters/group-by): temporality resolved
   * at generation time; joinless single-branch shapes. */
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: label join stays, dead temporality variant is
   * not emitted. */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level == null)
      throw new Error('quantile must have a level');
    return histogramRollupQuantileCtesV2({
      ...rest,
      level: select.level,
      resolved,
    });
  }
  if (select.aggFn === 'count') {
    return histogramScalarRollupCtesV2({
      ...rest,
      mode: 'count',
      fast,
      resolved,
    });
  }
  if (select.aggFn === 'avg') {
    return histogramScalarRollupCtesV2({
      ...rest,
      mode: 'avg',
      fast,
      resolved,
    });
  }
  throw new Error(
    `${select.aggFn} is not supported for histogram rollups currently`,
  );
};

export const translateExpHistogramV2 = ({
  select,
  temporality,
  fast,
  ...rest
}: {
  /** Whole-metric fast path (no filters/group-by): temporality resolved
   * at generation time; joinless single-branch shapes. */
  fast?: { temporality: 'delta' | 'cumulative' };

  select: Exclude<BuilderChartConfig['select'], string>[number];
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  /** Resolved from the series table at SQL-generation time; when known, a
   * single temporality branch is emitted (the dual-path shape computes both
   * variants per point — measured −39% wall / −47% spill for cumulative,
   * more for delta which drops the window sort entirely). */
  temporality?: 'delta' | 'cumulative';
}): WithClauses => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level == null)
      throw new Error('quantile must have a level');
    return expHistogramQuantileCtesV2({
      ...rest,
      level: select.level,
      temporality,
      // joinless only when a single temporality branch is emitted
      fast: fast != null && temporality != null,
    });
  }
  if (select.aggFn === 'count') {
    return histogramCountCtesV2({ ...rest, fast, resolved: { temporality } });
  }
  throw new Error(
    `${select.aggFn} is not supported for exponential histograms currently`,
  );
};

export const translateSummaryV2 = ({
  select,
  fast,
  resolved,
  ...rest
}: {
  select: Exclude<BuilderChartConfig['select'], string>[number];
  /** Whole-metric fast path (no filters/group-by): temporality resolved
   * at generation time; joinless single-branch shapes. */
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: label join stays, dead temporality variant is
   * not emitted. */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level == null)
      throw new Error('quantile must have a level');
    return summaryQuantileCtesV2({
      ...rest,
      level: select.level,
    });
  }
  if (select.aggFn === 'count') {
    return histogramCountCtesV2({ ...rest, fast, resolved });
  }
  throw new Error(`${select.aggFn} is not supported for summaries currently`);
};

/** Builds the absolute-index positive-bucket map from a
 * (PositiveBucketCounts, PositiveOffset) tuple. Kept as a late-stage
 * construction: Map aggregation states in the hot per-point GROUP BY are the
 * dominant cost at scale (~80% of a large exp-hist scan), so the hot path
 * carries plain tuples and maps are built only where the math needs them. */
const expTupleToMap = (tuple: string) =>
  `mapFromArrays(
    arrayMap(i -> toInt64(${tuple}.2 + i - 1), arrayEnumerate(${tuple}.1)),
    CAST(${tuple}.1, 'Array(Int64)')
  )`;

type ExpBranchArgs = {
  fast?: boolean;
  timeBucketSelect: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
};

/** Delta branch: points (and same-ts duplicates) are additive, so a single
 * GROUP BY collapses raw points directly to (series, display bucket) —
 * no per-ts dedup pass and no window sort. */
const deltaExpCtes = ({
  fast,
  timeBucketSelect,
  pointsFrom,
  pointsWhere,
}: ExpBranchArgs): WithClauses => [
  {
    name: 'ExpPerSeries',
    sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        min(Scale) AS scale,
        sumMap(
          mapFromArrays(
            arrayMap(i -> toInt64(PositiveOffset + i - 1), arrayEnumerate(PositiveBucketCounts)),
            CAST(PositiveBucketCounts, 'Array(Int64)')
          )
        ) AS pos,
        sum(toInt64(ZeroCount)) AS zero
      FROM ${pointsFrom}
      WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
  },
];

/** Cumulative branch: per-(series, ts) dedup picks the row with the highest
 * Count as a (buckets, offset) tuple state (cheap in the hot hash table);
 * the lag window carries tuples too; maps are built only at the
 * differencing step. */
const cumulativeExpCtes = ({
  fast,
  timeBucketSelect,
  pointsFrom,
  pointsWhere,
}: ExpBranchArgs): WithClauses => [
  {
    name: 'ExpRaw',
    sql: chSql`
      SELECT
        TimeUnix,
        \`__hdx_time_bucket\`,
        SeriesHash,
        Scale,
        tpl,
        zero_count,
        total_count,
        any(tpl) OVER w AS prev_tpl,
        any(toNullable(zero_count)) OVER w AS prev_zero,
        any(toNullable(total_count)) OVER w AS prev_total,
        ${'' /* first sample emits 0 (canonical rule: a newly-born series' cumulative history is NOT an increase); ONLY a genuine reset (count decrease) credits the full current value. Empty-map arm must match expTupleToMap's Map(Int64, Int64) exactly or the IF arms collapse into a Variant. */}
        IF(
          prev_total IS NULL,
          CAST(map(), 'Map(Int64, Int64)'),
          IF(
            total_count < prev_total,
            ${expTupleToMap('tpl')},
            mapSubtract(${expTupleToMap('tpl')}, ${expTupleToMap('prev_tpl')})
          )
        ) AS pos_if_cum,
        multiIf(
          prev_total IS NULL, toInt64(0),
          total_count < prev_total, zero_count,
          zero_count - prev_zero
        ) AS zero_if_cum
      FROM (
        SELECT
          TimeUnix,
          ${timeBucketSelect},
          SeriesHash,
          any(Scale) AS Scale,
          argMax((PositiveBucketCounts, PositiveOffset), Count) AS tpl,
          max(toInt64(ZeroCount)) AS zero_count,
          max(toInt64(Count)) AS total_count
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
    `,
  },
  {
    name: 'ExpPerSeries',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        min(Scale) AS scale,
        sumMap(pos_if_cum) AS pos,
        sum(zero_if_cum) AS zero
      FROM ExpRaw
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
  },
];

/** Legacy dual-path shape (both temporality variants per point, picked by
 * s.Temporality after the join). Fallback when temporality could not be
 * resolved at generation time. */
const dualExpCtes = ({
  timeBucketSelect,
  pointsFrom,
  pointsWhere,
}: ExpBranchArgs): WithClauses => [
  {
    // Same-timestamp duplicates collapse per (series, ts) first: cumulative
    // reads take the row with the highest Count (argMax/max — the true
    // counter state); delta reads merge additively (sumMap/sum).
    name: 'ExpRaw',
    sql: chSql`
      SELECT
        TimeUnix,
        \`__hdx_time_bucket\`,
        SeriesHash,
        Scale,
        posMap,
        posMap_delta,
        zero_count,
        zero_delta,
        total_count,
        any(posMap) OVER w AS prev_posMap,
        any(toNullable(zero_count)) OVER w AS prev_zero,
        any(toNullable(total_count)) OVER w AS prev_total,
        ${'' /* first sample emits 0; only a genuine reset credits the full current map (see cumulativeExpCtes) */}
        IF(
          prev_total IS NULL,
          CAST(map(), 'Map(Int64, Int64)'),
          IF(
            total_count < prev_total,
            posMap,
            mapSubtract(posMap, prev_posMap)
          )
        ) AS pos_if_cum,
        multiIf(
          prev_total IS NULL, toInt64(0),
          total_count < prev_total, zero_count,
          zero_count - prev_zero
        ) AS zero_if_cum
      FROM (
        SELECT
          TimeUnix,
          ${timeBucketSelect},
          SeriesHash,
          any(Scale) AS Scale,
          argMax(
            mapFromArrays(
              arrayMap(i -> toInt64(PositiveOffset + i - 1), arrayEnumerate(PositiveBucketCounts)),
              CAST(PositiveBucketCounts, 'Array(Int64)')
            ),
            Count
          ) AS posMap,
          sumMap(
            mapFromArrays(
              arrayMap(i -> toInt64(PositiveOffset + i - 1), arrayEnumerate(PositiveBucketCounts)),
              CAST(PositiveBucketCounts, 'Array(Int64)')
            )
          ) AS posMap_delta,
          max(toInt64(ZeroCount)) AS zero_count,
          sum(toInt64(ZeroCount)) AS zero_delta,
          max(toInt64(Count)) AS total_count
        FROM ${pointsFrom}
        WHERE ${pointsWhere} AND ${SERIES_HASH_FILTER} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
    `,
  },
  {
    name: 'ExpPerSeries',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        min(Scale) AS scale,
        sumMap(posMap_delta) AS pos_if_delta,
        sumMap(pos_if_cum) AS pos_if_cum,
        sum(zero_delta) AS zero_if_delta,
        sum(zero_if_cum) AS zero_if_cum
      FROM ExpRaw
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
  },
];

/**
 * Exponential histogram quantile (cookbook §5.6). Bucket k (absolute index)
 * covers (base^k, base^(k+1)] with base = 2^(2^-Scale).
 *
 * When `temporality` is resolved at generation time only that branch is
 * emitted (the dual-path shape computes both variants per point and picks
 * post-join — measured −39% wall / −47% spill for cumulative; delta
 * additionally drops the whole window-sort phase):
 *   delta      → duplicates and points are additive, so one GROUP BY goes
 *                straight from raw points to (series, display bucket) — no
 *                dedup pass, no window.
 *   cumulative → per-(series, ts) dedup picks the true counter sample as an
 *                argMax (buckets, offset) TUPLE state; the lag window carries
 *                tuples too, and maps are built only at the differencing
 *                step (a Count decrease marks a reset → full counts,
 *                Prometheus semantics).
 *   undefined  → legacy dual-path shape (both variants per point, chosen by
 *                s.Temporality after the join) — fallback for the
 *                not-a-real-case of mixed temporality under one name.
 *
 * All variants converge on ExpJoined(bucket, group?, scale, chosenMap,
 * chosenZero), then the shared tail: ExpScaled (min Scale per group+bucket),
 * source (downscale indices k -> floor(k / 2^d), merge across series),
 * metrics (rank incl. zero bucket, interpolate within (base^k, base^(k+1)]).
 */
const expHistogramQuantileCtesV2 = ({
  fast,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  level,
  temporality,
}: {
  fast?: boolean;
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
  temporality?: 'delta' | 'cumulative';
}): WithClauses => [
  ...(temporality === 'delta'
    ? deltaExpCtes({ fast, timeBucketSelect, pointsFrom, pointsWhere })
    : temporality === 'cumulative'
      ? cumulativeExpCtes({ fast, timeBucketSelect, pointsFrom, pointsWhere })
      : dualExpCtes({ timeBucketSelect, pointsFrom, pointsWhere })),
  {
    name: 'ExpJoined',
    sql:
      temporality === 'delta' || temporality === 'cumulative'
        ? chSql`
      SELECT
        p.\`__hdx_time_bucket\` AS \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        p.scale AS scale,
        p.pos AS chosenMap,
        p.zero AS chosenZero
      FROM ExpPerSeries AS p${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash`
      }
    `
        : chSql`
      SELECT
        p.\`__hdx_time_bucket\` AS \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        p.scale AS scale,
        IF(s.Temporality = 'delta', p.pos_if_delta, p.pos_if_cum) AS chosenMap,
        IF(s.Temporality = 'delta', p.zero_if_delta, p.zero_if_cum) AS chosenZero
      FROM ExpPerSeries AS p
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash
    `,
  },
  ...expQuantileTailCtes({ groupBy, valueAlias, level }),
];

/**
 * Shared exp-histogram quantile tail. Consumes ExpJoined(bucket, group?,
 * scale, chosenMap, chosenZero): ExpScaled finds the min scale per
 * group+bucket, source downscale-merges bucket indices (k -> floor(k / 2^d),
 * exact bucket algebra — recipe R4), metrics ranks (zero bucket included)
 * and interpolates within (base^k, base^(k+1)].
 */
const expQuantileTailCtes = ({
  groupBy,
  valueAlias,
  level,
}: {
  groupBy?: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
}): WithClauses => [
  {
    name: 'ExpScaled',
    sql: chSql`
      SELECT
        *,
        min(scale) OVER (PARTITION BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`) AS minScale
      FROM ExpJoined
    `,
  },
  {
    name: 'source',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? 'group,' : ''}
        minScale,
        sumMap(
          arrayMap(k -> toInt64(floor(k / exp2(scale - minScale))), mapKeys(chosenMap)),
          arrayMap(v -> toInt64(v), mapValues(chosenMap))
        ) AS merged,
        sum(toInt64(chosenZero)) AS zeroTotal
      FROM ExpScaled
      GROUP BY \`__hdx_time_bucket\`, ${groupBy ? 'group, ' : ''}minScale
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? 'group,' : ''}
        merged.1 AS ks,
        merged.2 AS vs,
        arrayCumSum(vs) AS cum,
        zeroTotal + arraySum(vs) AS total,
        ${{ Float64: level }} * total AS rank,
        exp2(exp2(-minScale)) AS base,
        arrayFirstIndex(c -> (c + zeroTotal) >= rank, cum) AS idx,
        multiIf(
          rank <= zeroTotal, 0.,
          idx = 0, pow(base, ks[length(ks)] + 1), ${'' /* numeric edge: rank past the last bucket */}
          vs[idx] = 0, pow(base, ks[idx]),
          pow(base, ks[idx]) + (pow(base, ks[idx] + 1) - pow(base, ks[idx])) * ((rank - (zeroTotal + if(idx = 1, 0, cum[idx - 1]))) / vs[idx])
        ) AS "${valueAlias}"
      FROM source
      WHERE total > 0
    `,
  },
];

/**
 * Exponential histogram over the 5m/1h rollup tiers (EXP_HISTOGRAM_ROLLUPS
 * recipes R1-R4). Scale is part of the tier's aggregation key — bucket maps
 * are only ever summed within one scale (GROUP BY Scale everywhere, sharp
 * edge #1); the shared quantile tail downscale-merges across scales (R4).
 * Tier rows are marker-free by construction (the 5m MV filters
 * FLAG_NO_RECORDED_VALUE at insert), so no Flags predicate here.
 */
export const translateExpHistogramRollupV2 = ({
  select,
  temporality,
  fast,
  ...rest
}: {
  /** Whole-metric fast path (no filters/group-by): temporality resolved
   * at generation time; joinless single-branch shapes. */
  fast?: { temporality: 'delta' | 'cumulative' };

  select: Exclude<BuilderChartConfig['select'], string>[number];
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  temporality?: 'delta' | 'cumulative';
}): WithClauses => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level == null)
      throw new Error('quantile must have a level');
    return expHistogramRollupQuantileCtesV2({
      ...rest,
      level: select.level,
      temporality,
      fast: fast != null && temporality != null,
    });
  }
  if (select.aggFn === 'count') {
    return expHistogramScalarRollupCtesV2({
      ...rest,
      fast,
      resolved: { temporality },
    });
  }
  throw new Error(
    `${select.aggFn} is not supported for exponential histogram rollups currently`,
  );
};

/** Per-(series, tier bucket, scale) First/Last snapshots merged from the
 * tier's tuple states. Shared by the cumulative quantile chain and (Count
 * projection) the scalar count chain. */
const expTierCte = ({
  fast,
  pointsFrom,
  pointsWhere,
}: {
  fast?: boolean;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
}): WithClauses[number] => ({
  name: 'ExpTier',
  sql: chSql`
    SELECT
      SeriesHash,
      TimeBucket,
      Scale,
      argMinMerge(First) AS f,
      argMaxMerge(Last) AS l,
      sumMap(SumPositive) AS pos_delta,
      sum(SumZeroCount) AS zero_delta
    FROM ${pointsFrom}
    WHERE ${pointsWhere}${seriesScanFilter(fast)}
    GROUP BY SeriesHash, TimeBucket, Scale
  `,
});

/** Cumulative chaining over tier buckets (recipe R2, with the improved
 * within-bucket reset handling used by the float/histogram rollup chains):
 * per-bucket increase = cross-bucket part (reset between buckets: count F
 * fully) + within-bucket part (reset inside the bucket: count L fully).
 * Reset detection is scalar on the tuples' Count (the appendix shape is
 * validated to agree exactly with R2's per-key form). Bucket-map algebra is
 * signed: mapSubtract of UInt64 maps yields Int64 values, so the IF arms
 * cast to Map(Int32, Int64). */
const EXP_CHAIN_WINDOW = `PARTITION BY SeriesHash, Scale ORDER BY TimeBucket ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING`;
const expChainedCte = (): WithClauses[number] => ({
  name: 'ExpChained',
  sql: chSql`
    SELECT
      SeriesHash,
      TimeBucket,
      Scale,
      pos_delta,
      zero_delta,
      tupleElement(f, 'PositiveBuckets') AS fPos,
      tupleElement(l, 'PositiveBuckets') AS lPos,
      toFloat64(tupleElement(f, 'Count')) AS fCount,
      toFloat64(tupleElement(l, 'Count')) AS lCount,
      toInt64(tupleElement(f, 'ZeroCount')) AS fZero,
      toInt64(tupleElement(l, 'ZeroCount')) AS lZero,
      any(lPos) OVER w AS prevLPos,
      any(toNullable(lCount)) OVER w AS prevLCount,
      any(toNullable(lZero)) OVER w AS prevLZero,
      ${'' /* mapSubtract keeps unsigned value types on some versions, so cast to signed maps first — every IF arm must be Map(Int32, Int64) or the arms collapse into a Variant */}
      mapAdd(
        IF(
          prevLCount IS NULL,
          CAST(map(), 'Map(Int32, Int64)'),
          IF(
            fCount >= prevLCount,
            mapSubtract(CAST(fPos, 'Map(Int32, Int64)'), CAST(prevLPos, 'Map(Int32, Int64)')),
            CAST(fPos, 'Map(Int32, Int64)')
          )
        ),
        IF(
          lCount >= fCount,
          mapSubtract(CAST(lPos, 'Map(Int32, Int64)'), CAST(fPos, 'Map(Int32, Int64)')),
          CAST(lPos, 'Map(Int32, Int64)')
        )
      ) AS pos_inc_cum,
      assumeNotNull(
        IF(prevLCount IS NULL, 0, IF(fCount >= prevLCount, fZero - prevLZero, fZero))
          + IF(lCount >= fCount, lZero - fZero, lZero)
      ) AS zero_inc_cum
    FROM ExpTier
    WINDOW w AS (${EXP_CHAIN_WINDOW})
  `,
});

/**
 * Exp-histogram rollup quantile. Delta reads are exact tier sums (R1);
 * cumulative reads chain First/Last tuples per (series, scale) across tier
 * buckets (R2). Rows stay keyed per (series, display bucket, scale) into the
 * shared tail, whose ExpScaled/source CTEs downscale-merge multi-scale rows
 * (R4). Unresolved temporality computes both variants and picks post-join.
 */
const expHistogramRollupQuantileCtesV2 = ({
  fast,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  level,
  temporality,
}: {
  fast?: boolean;
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
  temporality?: 'delta' | 'cumulative';
}): WithClauses => [
  ...(temporality === 'delta'
    ? ([
        {
          name: 'ExpPerSeries',
          sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        Scale AS scale,
        sumMap(SumPositive) AS pos,
        sum(SumZeroCount) AS zero
      FROM ${pointsFrom}
      WHERE ${pointsWhere}${seriesScanFilter(fast)}
      GROUP BY SeriesHash, \`__hdx_time_bucket\`, Scale
    `,
        },
      ] satisfies WithClauses)
    : temporality === 'cumulative'
      ? ([
          expTierCte({ fast, pointsFrom, pointsWhere }),
          expChainedCte(),
          {
            name: 'ExpPerSeries',
            sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        Scale AS scale,
        sumMap(pos_inc_cum) AS pos,
        sum(zero_inc_cum) AS zero
      FROM ExpChained
      GROUP BY SeriesHash, \`__hdx_time_bucket\`, Scale
    `,
          },
        ] satisfies WithClauses)
      : ([
          expTierCte({ fast, pointsFrom, pointsWhere }),
          expChainedCte(),
          {
            name: 'ExpPerSeries',
            sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        Scale AS scale,
        sumMap(pos_delta) AS pos_if_delta,
        sum(zero_delta) AS zero_if_delta,
        sumMap(pos_inc_cum) AS pos_if_cum,
        sum(zero_inc_cum) AS zero_if_cum
      FROM ExpChained
      GROUP BY SeriesHash, \`__hdx_time_bucket\`, Scale
    `,
          },
        ] satisfies WithClauses)),
  {
    name: 'ExpJoined',
    sql:
      temporality === 'delta' || temporality === 'cumulative'
        ? chSql`
      SELECT
        p.\`__hdx_time_bucket\` AS \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        p.scale AS scale,
        p.pos AS chosenMap,
        p.zero AS chosenZero
      FROM ExpPerSeries AS p${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash`
      }
    `
        : chSql`
      SELECT
        p.\`__hdx_time_bucket\` AS \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        p.scale AS scale,
        IF(s.Temporality = 'delta', CAST(p.pos_if_delta, 'Map(Int32, Int64)'), p.pos_if_cum) AS chosenMap,
        IF(s.Temporality = 'delta', toInt64(p.zero_if_delta), p.zero_if_cum) AS chosenZero
      FROM ExpPerSeries AS p
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash
    `,
  },
  ...expQuantileTailCtes({ groupBy, valueAlias, level }),
];

/**
 * Exp-histogram rollup count: delta → exact sum(SumCount); cumulative →
 * scalar Count chain over the First/Last tuples (R2's scalar form with the
 * improved within-bucket reset handling). Scalars are scale-independent, so
 * the tier scan merges across Scale rows directly.
 */
const expHistogramScalarRollupCtesV2 = ({
  fast,
  resolved,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
}: {
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: keep the label join, drop the dead temporality
   * variant (delta-resolved drops the Count chaining window pass). */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const needCum = temporality !== 'delta';
  const needDelta = temporality !== 'cumulative';
  const incExpr =
    temporality === 'delta'
      ? 'p.inc_if_delta'
      : temporality === 'cumulative'
        ? 'p.inc_if_cumulative'
        : `IF(s.Temporality = 'delta', p.inc_if_delta, p.inc_if_cumulative)`;
  return [
    {
      name: 'ScalarTier',
      sql: chSql`
      SELECT
        SeriesHash,
        TimeBucket${
          needCum
            ? `,
        toFloat64(tupleElement(argMinMerge(First), 'Count')) AS FC,
        toFloat64(tupleElement(argMaxMerge(Last), 'Count')) AS LC`
            : ''
        }${
          needDelta
            ? `,
        toFloat64(sum(SumCount)) AS count_inc_delta`
            : ''
        }
      FROM ${pointsFrom}
      WHERE ${pointsWhere}${seriesScanFilter(fast)}
      GROUP BY SeriesHash, TimeBucket
    `,
    },
    {
      name: 'Chained',
      sql: needCum
        ? chSql`
      SELECT
        *,
        any(toNullable(LC)) OVER w AS prevLC,
        IF(prevLC IS NULL, 0, IF(FC >= prevLC, FC - prevLC, FC)) + IF(LC >= FC, LC - FC, LC) AS count_inc_cum
      FROM ScalarTier
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeBucket ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
    `
        : chSql`
      SELECT *
      FROM ScalarTier
    `,
    },
    {
      name: 'CountPerSeries',
      sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash${
          needDelta
            ? `,
        sum(count_inc_delta) AS inc_if_delta`
            : ''
        }${
          needCum
            ? `,
        sum(count_inc_cum) AS inc_if_cumulative`
            : ''
        }
      FROM Chained
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
    },
    {
      name: 'metrics',
      sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        sum(${incExpr}) AS "${valueAlias}"
      FROM CountPerSeries AS p${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash`
      }
      GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
    `,
    },
  ];
};

/**
 * Summary quantile: each point carries pre-computed quantile values
 * positionally aligned with the series' Quantiles levels. Takes the last
 * point per (series, bucket), picks the closest level >= the requested one
 * (falling back to the highest), and averages across series — summary
 * quantiles are not mergeable, so the cross-series average is an
 * approximation (standard practice).
 */
const summaryQuantileCtesV2 = ({
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  level,
}: {
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
}): WithClauses => [
  {
    // Same-timestamp duplicates collapse per (series, ts) to the row with
    // the highest Count (the freshest summary state) before the last-per-
    // bucket pick.
    name: 'SummPerSeries',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        argMax(QuantileValues, TimeUnix) AS qvals
      FROM (
        SELECT
          TimeUnix,
          ${timeBucketSelect},
          SeriesHash,
          argMax(QuantileValues, Count) AS QuantileValues
        FROM ${pointsFrom}
        WHERE ${pointsWhere} AND ${SERIES_HASH_FILTER} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? 'group,' : ''}
        avg(qv) AS "${valueAlias}"
      FROM (
        SELECT
          p.\`__hdx_time_bucket\` AS \`__hdx_time_bucket\`,
          ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
          arrayFirstIndex(q -> q >= ${{ Float64: level }}, s.Quantiles) AS idx_raw,
          if(idx_raw = 0, length(s.Quantiles), idx_raw) AS idx,
          p.qvals[idx] AS qv
        FROM SummPerSeries AS p
        INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash
        WHERE length(s.Quantiles) > 0
      )
      GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
    `,
  },
];

/**
 * Count for histogram-family types (explicit/exp histograms, summaries):
 * per-series lag diff on Count (both temporality variants), then join labels
 * and sum the right variant per bucket/group.
 */
const histogramCountCtesV2 = ({
  fast,
  resolved,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
}: {
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: keep the label join, drop the dead temporality
   * variant (delta-resolved drops the per-series window sort entirely). */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const needCum = temporality !== 'delta';
  const needDelta = temporality !== 'cumulative';
  const incExpr =
    temporality === 'delta'
      ? 'p.inc_if_delta'
      : temporality === 'cumulative'
        ? 'p.inc_if_cumulative'
        : `IF(s.Temporality = 'delta', p.inc_if_delta, p.inc_if_cumulative)`;
  return [
    {
      // Same-timestamp duplicates collapse per (series, ts) first: cumulative
      // reads take max(Count) (the true counter sample — a lower duplicate
      // must not fire the reset branch), delta reads take sum(Count).
      //
      // Prometheus reset semantics, consistent with the scalar counter path:
      // first row of a series contributes NULL (ignored by sum), a Count
      // decrease means restart → the full post-reset count is the increase.
      name: 'source',
      sql: chSql`
      SELECT
        TimeUnix,
        \`__hdx_time_bucket\`,
        SeriesHash${
          needDelta
            ? `,
        count_delta AS delta_if_delta`
            : ''
        }${
          needCum
            ? `,
        lagInFrame(toNullable(count_cum), 1, NULL) OVER (
          PARTITION BY SeriesHash
          ORDER BY TimeUnix
        ) AS prev_count,
        multiIf(
          prev_count IS NULL, NULL,
          count_cum >= prev_count, count_cum - prev_count,
          count_cum
        ) AS delta_if_cumulative`
            : ''
        }
      FROM (
        SELECT
          TimeUnix,
          ${timeBucketSelect},
          SeriesHash${
            needCum
              ? `,
          max(toInt64(Count)) AS count_cum`
              : ''
          }${
            needDelta
              ? `,
          sum(toInt64(Count)) AS count_delta`
              : ''
          }
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
    `,
    },
    {
      // Pre-aggregate to one row per (series, bucket) BEFORE the label join.
      name: 'CountPerSeries',
      sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash${
          needDelta
            ? `,
        sum(delta_if_delta) AS inc_if_delta`
            : ''
        }${
          needCum
            ? `,
        sum(delta_if_cumulative) AS inc_if_cumulative`
            : ''
        }
      FROM source
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
    },
    {
      name: 'metrics',
      sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        sum(${incExpr}) AS "${valueAlias}"
      FROM CountPerSeries AS p${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash`
      }
      GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
    `,
    },
  ];
};

/**
 * Histogram quantile: per-series per-bucket bucket-count increases (window
 * lag within SeriesHash — bounds are series identity in v2, so no
 * bounds_hash/attr_hash tracking is needed), summed across series per
 * (bucket, group, bounds) after the label join, then the same cumulative
 * interpolation ('points'/'metrics' CTEs) as the v1 histogram path.
 */
const histogramQuantileCtesV2 = ({
  resolved,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  level,
}: {
  /** Resolved temporality at SQL-generation time: quantiles always keep the
   * label join (ExplicitBounds is series identity), but the dead variant —
   * a per-point ARRAY window pass for cumulative, a sumForEach for delta —
   * is not emitted. */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
}): WithClauses => {
  const temporality = resolved?.temporality;
  const needCum = temporality !== 'delta';
  const needDelta = temporality !== 'cumulative';
  return [
    {
      // Same-timestamp duplicates collapse per (series, ts) before the window
      // lag: cumulative reads take argMax(BucketCounts, Count) (the row with
      // the true counter state), delta reads take sumForEach (additive).
      name: 'HistRaw',
      sql: chSql`
      SELECT
        TimeUnix,
        ${timeBucketSelect},
        SeriesHash${
          needDelta
            ? `,
        counts_delta`
            : ''
        }${
          needCum
            ? chSql`,
        counts,
        any(counts) OVER (
          PARTITION BY SeriesHash
          ORDER BY TimeUnix
          ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING
        ) AS prev_counts,
        ${'' /* first sample emits zeros (a newly-born series' cumulative history is NOT an increase); only a genuine reset (a per-le count went down) credits the full current counts. Same-length zeros array keeps all arms Array(Int64) with no CAST. */}
        IF(
          length(prev_counts) = 0,
          arrayMap(x -> toInt64(0), counts),
          IF(
            arrayExists((x) -> x.2 < x.1, arrayZip(prev_counts, counts)),
            counts,
            counts - prev_counts
          )
        ) AS cum_deltas`
            : ''
        }
      FROM (
        SELECT
          TimeUnix,
          SeriesHash${
            needCum
              ? `,
          CAST(argMax(BucketCounts, Count) AS Array(Int64)) AS counts`
              : ''
          }${
            needDelta
              ? `,
          CAST(sumForEach(BucketCounts) AS Array(Int64)) AS counts_delta`
              : ''
          }
        FROM ${pointsFrom}
        WHERE ${pointsWhere} AND ${SERIES_HASH_FILTER} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
    `,
    },
    {
      name: 'HistPerSeries',
      sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash${
          needDelta
            ? `,
        sumForEach(counts_delta) AS rates_if_delta`
            : ''
        }${
          needCum
            ? `,
        sumForEach(cum_deltas) AS rates_if_cumulative`
            : ''
        }
      FROM HistRaw
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
    },
    ...histogramQuantileMergeCtes({ groupBy, valueAlias, level, resolved }),
  ];
};

/**
 * Shared quantile tail for raw and rollup histogram paths. Consumes a
 * `HistPerSeries` CTE (one row per series+bucket with rates_if_delta /
 * rates_if_cumulative arrays): join labels + pick temporality variant, sum
 * per le across series (grouped by identical bounds), cumulate, interpolate.
 */
const histogramQuantileMergeCtes = ({
  groupBy,
  valueAlias,
  level,
  resolved,
}: {
  groupBy?: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
  /** Resolved temporality: static variant pick (the join stays — bounds are
   * series identity). */
  resolved?: { temporality?: 'delta' | 'cumulative' };
}): WithClauses => [
  {
    name: 'source',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        s.MetricName AS MetricName,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        s.ExplicitBounds AS ExplicitBounds,
        sumForEach(${
          resolved?.temporality === 'delta'
            ? 'p.rates_if_delta'
            : resolved?.temporality === 'cumulative'
              ? 'p.rates_if_cumulative'
              : `IF(s.Temporality = 'delta', p.rates_if_delta, p.rates_if_cumulative)`
        }) AS rates
      FROM HistPerSeries AS p
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash
      GROUP BY \`__hdx_time_bucket\`, MetricName, ${groupBy ? 'group, ' : ''}ExplicitBounds
      ORDER BY \`__hdx_time_bucket\`
    `,
  },
  {
    name: 'points',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        MetricName,
        ${groupBy ? 'group,' : ''}
        arrayZipUnaligned(arrayCumSum(rates), ExplicitBounds) as point,
        length(point) as n
      FROM source
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        MetricName,
        ${groupBy ? 'group,' : ''}
        point[n].1 AS total,
        ${{ Float64: level }} * total AS rank,
        arrayFirstIndex(x -> if(x.1 > rank, 1, 0), point) AS upper_idx,
        point[upper_idx].1 AS upper_count,
        ifNull(point[upper_idx].2, inf) AS upper_bound,
        CASE
          WHEN upper_idx > 1 THEN point[upper_idx - 1].2
          WHEN point[upper_idx].2 > 0 THEN 0
          ELSE inf
        END AS lower_bound,
        if (
          lower_bound = 0,
          0,
          point[upper_idx - 1].1
        ) AS lower_count,
        CASE
            WHEN upper_bound = inf THEN point[upper_idx - 1].2
            WHEN lower_bound = inf THEN point[1].2
            ELSE lower_bound + (upper_bound - lower_bound) * ((rank - lower_count) / (upper_count - lower_count))
        END AS "${valueAlias}"
      FROM points
      WHERE length(point) > 1 AND total > 0
    `,
  },
];

/**
 * Histogram rollup quantile (recipes a+b of the histogram-rollups spec).
 * One tier scan feeds both temporality variants:
 *   delta      → sumForEachMerge(SumBuckets), exact per-le increases;
 *   cumulative → per-le First/Last chaining across tier buckets (ARRAY JOIN
 *                by bucket index, window per (series, idx), reassembled into
 *                an increases array per series+display-bucket).
 * The correct variant is chosen after the label join by s.Temporality, then
 * the shared merge tail applies (sum per le across series → interpolate).
 */
const histogramRollupQuantileCtesV2 = ({
  resolved,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  level,
}: {
  /** Resolved temporality: delta-resolved skips the entire per-le chaining
   * subtree (ARRAY JOIN + window); cumulative-resolved skips the
   * sumForEachMerge state merge. Unknown keeps both variants. */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
}): WithClauses => {
  const temporality = resolved?.temporality;
  const needCum = temporality !== 'delta';
  const needDelta = temporality !== 'cumulative';
  return [
    {
      name: 'HistTier',
      sql: chSql`
      SELECT
        SeriesHash,
        TimeBucket${
          needDelta
            ? `,
        sumForEachMerge(SumBuckets) AS delta_incs`
            : ''
        }${
          needCum
            ? `,
        argMinMerge(FirstBuckets) AS FB,
        argMaxMerge(LastBuckets) AS LB`
            : ''
        }
      FROM ${pointsFrom}
      WHERE ${pointsWhere} AND ${SERIES_HASH_FILTER}
      GROUP BY SeriesHash, TimeBucket
    `,
    },
    ...(needDelta
      ? [
          {
            name: 'HistDeltaPerSeries',
            sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        sumForEach(CAST(delta_incs, 'Array(Int64)')) AS rates_if_delta
      FROM HistTier
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
          },
        ]
      : []),
    ...(needCum
      ? [
          {
            // Per-le counter chaining: cast to Float64 before subtracting (raw
            // columns are UInt64 — a reset would otherwise underflow). Cross-bucket
            // part counts F fully on a between-bucket reset; within-bucket part
            // counts L fully on an in-bucket reset.
            name: 'HistCumPerSeries',
            sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        arrayMap(t -> t.2, arraySort(t -> t.1, groupArray((idx, inc)))) AS rates_if_cumulative
      FROM (
        SELECT ${timeBucketSelect}, SeriesHash, idx, sum(bucket_increase) AS inc
        FROM (
          SELECT
            SeriesHash,
            TimeBucket,
            idx,
            F,
            L,
            any(toNullable(L)) OVER (
              PARTITION BY SeriesHash, idx
              ORDER BY TimeBucket
              ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING
            ) AS prevL,
            ${'' /* assumeNotNull: the IS NULL guard makes the value non-null, but the type stays Nullable, which arrayCumSum downstream rejects */}
            assumeNotNull(IF(prevL IS NULL, 0, IF(F >= prevL, F - prevL, F)) + IF(L >= F, L - F, L)) AS bucket_increase
          FROM (
            SELECT SeriesHash, TimeBucket, idx, toFloat64(FB[idx]) AS F, toFloat64(LB[idx]) AS L
            FROM HistTier
            ARRAY JOIN arrayEnumerate(FB) AS idx
          )
        )
        GROUP BY SeriesHash, \`__hdx_time_bucket\`, idx
      )
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
          },
        ]
      : []),
    {
      name: 'HistPerSeries',
      sql:
        needDelta && needCum
          ? chSql`
      SELECT
        d.\`__hdx_time_bucket\` AS \`__hdx_time_bucket\`,
        d.SeriesHash AS SeriesHash,
        CAST(d.rates_if_delta, 'Array(Float64)') AS rates_if_delta,
        c.rates_if_cumulative AS rates_if_cumulative
      FROM HistDeltaPerSeries AS d
      INNER JOIN HistCumPerSeries AS c
        ON d.SeriesHash = c.SeriesHash AND d.\`__hdx_time_bucket\` = c.\`__hdx_time_bucket\`
    `
          : needDelta
            ? chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        CAST(rates_if_delta, 'Array(Float64)') AS rates_if_delta
      FROM HistDeltaPerSeries
    `
            : chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        rates_if_cumulative
      FROM HistCumPerSeries
    `,
    },
    ...histogramQuantileMergeCtes({ groupBy, valueAlias, level, resolved }),
  ];
};

/**
 * Histogram rollup count / avg (recipe c): scalar First/Last(Count|Sum)
 * chaining for cumulative, exact SumCount/SumSum for delta. Sum increases
 * follow the Count chain's reset detection (counts are the monotone signal).
 * avg = sum of per-series Sum increases / sum of per-series Count increases
 * per group+bucket — never an average of averages.
 */
const histogramScalarRollupCtesV2 = ({
  fast,
  resolved,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  mode,
}: {
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: keep the label join, drop the dead temporality
   * variant (delta-resolved drops the First/Last chaining window pass). */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  mode: 'count' | 'avg';
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const needCum = temporality !== 'delta';
  const needDelta = temporality !== 'cumulative';
  const countExpr =
    temporality === 'delta'
      ? 'sum(c.count_inc_delta)'
      : temporality === 'cumulative'
        ? 'sum(c.count_inc_cum)'
        : `sum(IF(s.Temporality = 'delta', c.count_inc_delta, c.count_inc_cum))`;
  const sumExpr =
    temporality === 'delta'
      ? 'sum(c.sum_inc_delta)'
      : temporality === 'cumulative'
        ? 'sum(c.sum_inc_cum)'
        : `sum(IF(s.Temporality = 'delta', c.sum_inc_delta, c.sum_inc_cum))`;
  return [
    {
      name: 'ScalarTier',
      sql: chSql`
      SELECT
        SeriesHash,
        TimeBucket${
          needCum
            ? `,
        toFloat64(argMinMerge(FirstCount)) AS FC,
        toFloat64(argMaxMerge(LastCount)) AS LC,
        argMinMerge(FirstSum) AS FS,
        argMaxMerge(LastSum) AS LS`
            : ''
        }${
          needDelta
            ? `,
        toFloat64(sum(SumCount)) AS count_inc_delta,
        sum(SumSum) AS sum_inc_delta`
            : ''
        }
      FROM ${pointsFrom}
      WHERE ${pointsWhere}${seriesScanFilter(fast)}
      GROUP BY SeriesHash, TimeBucket
    `,
    },
    {
      name: 'Chained',
      sql: needCum
        ? chSql`
      SELECT
        *,
        any(toNullable(LC)) OVER w AS prevLC,
        any(toNullable(LS)) OVER w AS prevLS,
        IF(prevLC IS NULL, 0, IF(FC >= prevLC, FC - prevLC, FC)) + IF(LC >= FC, LC - FC, LC) AS count_inc_cum,
        IF(prevLC IS NULL, 0, IF(FC >= prevLC, FS - prevLS, FS)) + IF(LC >= FC, LS - FS, LS) AS sum_inc_cum
      FROM ScalarTier
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeBucket ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
    `
        : chSql`
      SELECT *
      FROM ScalarTier
    `,
    },
    {
      name: 'metrics',
      sql: chSql`
      SELECT
        ${timeBucketSelect},
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        ${mode === 'count' ? countExpr : `${sumExpr} / ${countExpr}`} AS "${valueAlias}"
      FROM Chained AS c${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON c.SeriesHash = s.SeriesHash`
      }
      GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
    `,
    },
  ];
};

/**
 * Raw histogram avg latency: per-series windowed increases of Sum and Count
 * (Prometheus reset semantics keyed on the Count column — the monotone
 * signal), temporality picked post-join, then
 * sum(Sum increases) / sum(Count increases) per group+bucket.
 */
const histogramAvgCtesV2 = ({
  fast,
  resolved,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
}: {
  fast?: { temporality: 'delta' | 'cumulative' };
  /** Resolved-but-not-fast: keep the label join, drop the dead temporality
   * variant (delta-resolved drops the per-series window pass). */
  resolved?: { temporality?: 'delta' | 'cumulative' };
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const needCum = temporality !== 'delta';
  const needDelta = temporality !== 'cumulative';
  const avgExpr =
    temporality === 'delta'
      ? `sum(p.sum_inc_delta) / sum(p.count_inc_delta)`
      : temporality === 'cumulative'
        ? `sum(p.sum_inc_cum) / sum(p.count_inc_cum)`
        : `sum(IF(s.Temporality = 'delta', p.sum_inc_delta, p.sum_inc_cum))
          / sum(IF(s.Temporality = 'delta', p.count_inc_delta, p.count_inc_cum))`;
  return [
    {
      // Same-timestamp duplicates collapse per (series, ts) first: cumulative
      // picks argMax(Sum, Count)/max(Count) (the true counter samples), delta
      // picks are additive sums.
      name: 'source',
      sql: chSql`
      SELECT
        TimeUnix,
        \`__hdx_time_bucket\`,
        SeriesHash${
          needDelta
            ? `,
        c_delta AS count_inc_delta,
        sm_delta AS sum_inc_delta`
            : ''
        }${
          needCum
            ? `,
        any(toNullable(c)) OVER w AS prevC,
        any(toNullable(sm)) OVER w AS prevS,
        multiIf(prevC IS NULL, NULL, c >= prevC, c - prevC, c) AS count_inc_cum,
        multiIf(prevC IS NULL, NULL, c >= prevC, sm - prevS, sm) AS sum_inc_cum`
            : ''
        }
      FROM (
        SELECT
          TimeUnix,
          ${timeBucketSelect},
          SeriesHash${
            needCum
              ? `,
          max(toFloat64(Count)) AS c,
          argMax(Sum, Count) AS sm`
              : ''
          }${
            needDelta
              ? `,
          sum(toFloat64(Count)) AS c_delta,
          sum(Sum) AS sm_delta`
              : ''
          }
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )${
        needCum
          ? `
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)`
          : ''
      }
    `,
    },
    {
      // Pre-aggregate to one row per (series, bucket) BEFORE the label join.
      name: 'AvgPerSeries',
      sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash${
          needCum
            ? `,
        sum(count_inc_cum) AS count_inc_cum,
        sum(sum_inc_cum) AS sum_inc_cum`
            : ''
        }${
          needDelta
            ? `,
        sum(count_inc_delta) AS count_inc_delta,
        sum(sum_inc_delta) AS sum_inc_delta`
            : ''
        }
      FROM source
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
    },
    {
      name: 'metrics',
      sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        ${avgExpr} AS "${valueAlias}"
      FROM AvgPerSeries AS p${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash`
      }
      GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
    `,
    },
  ];
};
