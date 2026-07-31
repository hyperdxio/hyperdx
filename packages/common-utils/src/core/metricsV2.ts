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
  /** min(FirstSeen): the identity's earliest sample timestamp within the
   * scanned Date range. The rollup sum path reads it as the recipe's
   * birth-bucket gate (tier states carry no StartTimeUnix — see
   * sumRollupCtesV2). */
  firstSeen?: boolean;
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
  if (needs.firstSeen) cols.add('FirstSeen');
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
  // min, not any: the series table carries one row per (Date, insert block)
  // with SimpleAggregateFunction(min) FirstSeen partial states.
  if (needs.firstSeen) add('FirstSeen', 'min(FirstSeen) AS FirstSeen');
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
 * Prometheus's instant-selector lookback delta: a gauge-class LEVEL
 * evaluation at time T reads the newest sample in (T − 300s, T]. This is
 * the DEFAULT semantics of every gauge-class LEVEL shape (gauges and
 * up-down-counter level aggregates) — no toggle. Fixed 300s, never a
 * function of the display bucket (a bare Prometheus selector at any step
 * looks back exactly this far).
 */
export const LEVEL_LOOKBACK_SECONDS = 300;

/** Display-bucket width for the level-lookback shapes: a resolved constant,
 * or late-bound to the dashboard interval in template mode. */
export type LevelLookbackBucket = { bucketSeconds: number | '$__interval_s' };

const levelBucketSql = (bucket: LevelLookbackBucket) => {
  const b = bucket.bucketSeconds;
  return typeof b === 'number'
    ? {
        bs: String(b),
        bms: String(b * 1000),
        bmsMinus1: String(b * 1000 - 1),
      }
    : {
        bs: '$__interval_s',
        bms: '($__interval_s * 1000)',
        bmsMinus1: '($__interval_s * 1000 - 1)',
      };
};

/**
 * Gauge-class LEVEL shape (gauges; up-down-counter level aggregates route
 * here too — the level IS the sample value). Under the DEFAULT Prometheus
 * 5-minute instant lookback (`levelLookback` set): per display bucket b the
 * per-series value is the newest non-marker sample in the trailing window
 * (bucketEnd − 300s, bucketEnd]; a marker as the newest in-window sample
 * kills the series (no carry past a marker); NaN is a real value and is
 * carried; a hole longer than 5 minutes renders absent. Aggregations fold
 * ACROSS the per-series looked-back values. Final CTE is named `Metrics`;
 * exposes LastValue + label columns.
 *
 * RAW lookback path: after the per-(SeriesHash, TimeUnix) transport-retry
 * collapse, each sample is fanned (ARRAY JOIN) to every display bucket whose
 * trailing window contains it: window ends E·bucket with E in
 * [ceil(t/bucket), ceil((t+300s)/bucket) − 1] — i.e. t ∈ (end−300s, end].
 * argMax per (series, display bucket) then picks the newest sample of each
 * window, and HAVING argMax(TsIsMarker, TimeUnix) = 0 applies the marker
 * kill. For bucket ≥ 300s each sample feeds at most one bucket (exactly one
 * at bucket = 300s, where the window IS the bucket — bit-identical to the
 * old bucket-scoped shape); at 60s buckets each sample feeds five. The scan
 * must be padded by the lookback (see LEVEL_LOOKBACK_SECONDS at the
 * callsite); over-scan fans into pre-window buckets and is trimmed by the
 * outer display-window WHERE. Bucket labels are epoch-second arithmetic
 * (UTC-anchored) — identical to toStartOfInterval for the second-scale
 * granularity ladder; day-scale buckets assume a UTC server, like the rest
 * of the epoch math here.
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
  levelLookback,
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
  /** The 5m-lookback fan-out (the default LEVEL semantics). Only valid with
   * `dropStaleBuckets` (the last-value pick shape — the isDelta path
   * consumes every deduped row and keeps the bucket-scoped shape). Omitted
   * when the display bucket width cannot be resolved. */
  levelLookback?: LevelLookbackBucket;
}): WithClauses => {
  const lb = levelLookback ? levelBucketSql(levelLookback) : undefined;
  return [
    {
      // Same-timestamp duplicates collapse to max(Value) per (series, ts)
      // before the per-bucket pick — deterministic instead of an argMax tie.
      // Marker rows are excluded from the value pick (maxIf / Rule-6 WHERE);
      // in the staleness-aware variants a timestamp where ALL rows are markers
      // survives dedup (TsIsMarker=1, ValueMax defaults to 0 but can only be
      // picked if newest — and then the HAVING drops the whole bucket row).
      // Markers must be SCANNED (no Rule-6 WHERE) so they can kill.
      name: 'Bucketed',
      sql: lb
        ? chSql`
      SELECT
        \`${timeBucketCol}\`,
        SeriesHash AS AttributesHash,
        argMax(ValueMax, TimeUnix) AS LastValue
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
      ARRAY JOIN arrayMap(
        n -> toDateTime((intDiv(toUnixTimestamp64Milli(TimeUnix) + ${lb.bmsMinus1}, ${lb.bms}) + toInt64(n) - 1) * ${lb.bs}),
        range(toUInt64(greatest(intDiv(toUnixTimestamp64Milli(TimeUnix) + ${String(LEVEL_LOOKBACK_SECONDS * 1000 - 1)}, ${lb.bms}) - intDiv(toUnixTimestamp64Milli(TimeUnix) + ${lb.bmsMinus1}, ${lb.bms}) + 1, 0)))
      ) AS \`${timeBucketCol}\`
      GROUP BY SeriesHash, \`${timeBucketCol}\`
      HAVING argMax(TsIsMarker, TimeUnix) = 0
    `
        : dropStaleBuckets
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
};

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
  startTimeLookbackSeconds,
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
  /** StartTime-aware first-sample credit (monotonic cumulative only). Per
   * the OTLP contract a cumulative sample's Value is the accumulation since
   * its StartTimeUnix, so when StartTimeUnix shows the series began recently
   * — within the scan lookback of the sample itself — the full Value IS the
   * increase and is credited instead of the unconditional first-sample NULL.
   * Pass the SAME lookback seconds the cumulative chain already scans back
   * (the per-sample gate deliberately bounds the credited accumulation span
   * by the lookback — the span the lag chain already tolerates between
   * samples — instead of scaling it with the panel window). This is exactly
   * the temporality-flip transition (the flip mints a new series identity
   * whose first sample carries StartTimeUnix = the previous delta sample's
   * timestamp) and the churn birth (first sample value 0 — crediting it
   * changes nothing); a series merely ENTERING the scan keeps NULL, its
   * StartTimeUnix predates the gate window. Undefined disables the gate
   * (defensive — every cumulative-capable caller has a lookback). */
  startTimeLookbackSeconds?: number;
}): WithClauses => {
  const temporality = fast?.temporality ?? resolved?.temporality;
  const isMonotonic = fast != null ? fast.isMonotonic : resolved?.isMonotonic;
  const needCum = temporality !== 'delta';
  const needCumMono = needCum && isMonotonic !== false;
  const needCumNonMono = needCum && isMonotonic !== true;
  const needDelta = temporality !== 'cumulative';
  const startGateSeconds =
    needCumMono && startTimeLookbackSeconds != null
      ? Math.ceil(startTimeLookbackSeconds)
      : undefined;
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
      // window function or bucket sum. Same-(SeriesHash, TimeUnix) rows are
      // OTLP transport retries by definition (a re-delivered export whose
      // rebatched insert block evades the exporter's dedup token), so BOTH
      // temporalities read max(Value): for cumulative a lower-valued
      // duplicate would otherwise look like a counter reset; for delta,
      // summing would double-count the retry. Delta points remain additive
      // across DISTINCT timestamps — that sum happens per display bucket.
      // With no duplicates max == the single value, so results are unchanged.
      // The GROUP BY streams in primary-key order
      // (MetricName, SeriesHash, TimeUnix).
      //
      // On the first row of each series partition lagInFrame returns NULL —
      // the row contributes nothing to the bucket-level sum() UNLESS the
      // sample's own StartTimeUnix declares a recent series start (within the
      // scan lookback of the sample), in which case the full Value is the
      // increase (see startTimeLookbackSeconds). Monotonic counter resets use
      // Prometheus semantics per the v2 cookbook (§5.8/§5.9): a decrease
      // means the counter restarted, so the full post-reset value counts as
      // the increase (rather than v1's clamp-to-0). Non-monotonic cumulative
      // sums (UpDownCounters) legitimately decrease, so their rate is the
      // plain (possibly negative) difference.
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
          PrevValue IS NULL, ${
            startGateSeconds != null
              ? `IF(StartTimeUnix >= TimeUnix - INTERVAL ${startGateSeconds} second, ValueMax, NULL)`
              : 'NULL'
          },
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
        sum(ValueMax) OVER (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS SumIfDelta`
            : ''
        }
      FROM (
        SELECT
          MetricName,
          SeriesHash,
          TimeUnix,
          max(Value) AS ValueMax${
            // duplicates are byte-identical re-sends, so any pick agrees;
            // max is deterministic under merges
            startGateSeconds != null
              ? `,
          max(StartTimeUnix) AS StartTimeUnix`
              : ''
          }
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
          sum(ValueMax) AS RateIfDelta,
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
 * Gauge-class LEVEL shape over a rollup tier (5m/1h AggregatingMergeTree),
 * under the default 5m instant lookback. Tier reads stay pre-aggregated —
 * no fan-out. Two branches:
 *
 * - Display bucket == tier bucket: the trailing lookback window of display
 *   bucket b is (b, b+300s], which for the 5m tier covers EXACTLY tier
 *   bucket b — so argMaxMerge(Last) of the OWN tier bucket IS the lookback
 *   evaluation (exact: lookback == tier width). For the 1h tier the window
 *   is only the trailing 5m of the tier bucket, and the Last state — which
 *   carries no within-bucket timestamp — is the documented stand-in: exact
 *   whenever a series' newest sample of the hour lands in its trailing 5
 *   minutes (true for every ≤5m-cadence series).
 * - Display bucket COARSER than the tier: only the LAST tier bucket of each
 *   display bucket sits inside the trailing lookback window (window end ==
 *   display bucket end == that tier bucket's end); every other tier row is
 *   invisible to every evaluation and is filtered out, then re-labeled to
 *   its display bucket start.
 *
 * Marker residual, both branches: tier rows are marker-free by construction
 * (the MV filters at insert), so a marker PRECEDED by same-tier-bucket real
 * samples of the same series cannot kill the state. Display buckets FINER
 * than the tier are unsupported on tiers — the router keeps them on raw.
 */
export const gaugeRollupCtesV2 = ({
  fast,
  needs,
  rollupFrom,
  rollupWhere,
  timeExpr,
  timeBucketCol,
  bucketSeconds,
  tierSeconds,
}: {
  fast?: boolean;
  needs: SeriesNeeds;
  rollupFrom: TemplatedInput;
  rollupWhere: TemplatedInput;
  timeExpr: TemplatedInput;
  timeBucketCol: string;
  /** Display bucket width; drives the branch pick (== tier vs coarser). */
  bucketSeconds: number;
  /** The routed tier's width (300 or 3600). */
  tierSeconds: number;
}): WithClauses => [
  {
    name: 'Bucketed',
    sql:
      bucketSeconds > tierSeconds
        ? chSql`
      SELECT
        toDateTime(toUnixTimestamp(TimeBucket) - ${String(bucketSeconds - tierSeconds)}) AS \`${timeBucketCol}\`,
        SeriesHash AS AttributesHash,
        argMaxMerge(Last) AS LastValue
      FROM ${rollupFrom}
      WHERE ${rollupWhere}${seriesScanFilter(fast)} AND ((toUnixTimestamp(TimeBucket) + ${String(tierSeconds)}) % ${String(bucketSeconds)}) = 0
      GROUP BY SeriesHash, \`${timeBucketCol}\`
    `
        : chSql`
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
 * shape: per tier bucket take (First, Last, Max) via argMin/argMaxMerge and
 * max, chain buckets per series with reset detection (a drop between buckets
 * means the counter restarted: count F fully; the stored Max recovers resets
 * INSIDE a bucket), then re-bucket to the display granularity. For delta
 * temporality the rollup Sum column is exact for once-delivered points
 * (late transport retries are dropped at insert by the exporter's
 * deterministic dedup token + widened deduplication windows).
 *
 * First-sample credit on tiers (the same rule as the raw path's
 * StartTimeUnix gate, expressed with the signals rollups actually store):
 * a new identity's first tier bucket has prevL IS NULL, and its F — the
 * identity's first sample — used to enter the chain only as a baseline,
 * dropping F's own accumulation. Tier states carry no StartTimeUnix, so the
 * recency gate is approximated by the series table's FirstSeen:
 * prevL IS NULL AND FirstSeen >= TimeBucket means this tier bucket CONTAINS
 * the identity's first-ever sample (its birth bucket) — credit F in full, on
 * top of the within-bucket part. A series merely entering the scan keeps the
 * baseline behavior (FirstSeen predates the bucket). Caveats:
 * (a) FirstSeen cannot verify that F's declared StartTime was recent — an
 * identity born with an ancient StartTime (a counter already running for
 * days when first scraped) is credited here but refused by the raw path's
 * StartTimeUnix gate; (b) FirstSeen is min() over the scanned Date range
 * only, so an identity silent since before the scan's first day could
 * masquerade as newborn if its first in-range sample lands in a displayed
 * prevL-IS-NULL bucket (needs a > lookback silence straddling BOTH the scan
 * start and a date boundary).
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
        argMaxMerge(Last) AS L,${
          needCumMono
            ? `
        max(Max) AS MaxV,`
            : ''
        }
        sum(Sum) AS SumAgg
      FROM ${rollupFrom}
      WHERE ${rollupWhere}${seriesScanFilter(fast)}
      GROUP BY SeriesHash, TimeBucket
    `,
    },
    {
      // The birth-bucket gate needs the series table's FirstSeen next to the
      // window chain, so the monotonic-cumulative variants join Series INTO
      // Chained (1:1 per SeriesHash: the window partitions are unaffected).
      // Shapes without that variant keep the plain pass-through. NOTE: the
      // whole-metric fast path also carries this join — the caller includes
      // the Series CTE whenever the monotonic-cumulative rollup shape is
      // emitted (see renderChartConfig).
      name: 'Chained',
      sql: chSql`
      SELECT
        ${
          needCumMono
            ? `src.*,
        s.FirstSeen AS FirstSeen`
            : '*'
        }${
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
        ${'' /* cross-bucket part (reset between buckets: count F fully; birth bucket: the FirstSeen gate credits F when the series table says the identity was born inside this bucket) + within-bucket part. The tier's stored Max detects a reset INSIDE the bucket (Max > L means some sample exceeded the final one, i.e. the counter restarted mid-bucket) and recovers the pre-reset climb: (Max - F) + L. Keying detection on Max rather than L < F also counts resets whose post-reset accumulation re-crosses F. Residual: 2+ resets inside ONE tier bucket still undercount (the climb between them is invisible to First/Last/Max) — the raw path remains exact. The histogram/exp tier COUNT chains have no Max-of-Count column, so mid-bucket resets stay a raw-path-only guarantee there (tier quantiles are rank-insensitive to the loss). */}
        IF(prevL IS NULL, IF(FirstSeen >= TimeBucket, F, 0), IF(F >= prevL, F - prevL, F)) + IF(L >= MaxV, L - F, (MaxV - F) + L) AS IncIfCumulative`
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
      FROM ${
        needCumMono
          ? `Source AS src
      INNER JOIN Series AS s ON src.AttributesHash = s.SeriesHash`
          : 'Source'
      }
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
  if (select.aggFn === 'min' || select.aggFn === 'max') {
    return histogramExtremeCtesV2({
      ...rest,
      mode: select.aggFn,
      fast: fast != null,
      rawMarkerFilter: true,
    });
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
  if (select.aggFn === 'min' || select.aggFn === 'max') {
    // Tier Min/Max are marker-free SimpleAggregateFunction columns with the
    // same names as the raw columns, so the same shape serves both paths.
    return histogramExtremeCtesV2({
      ...rest,
      mode: select.aggFn,
      fast: fast != null,
      rawMarkerFilter: false,
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
  if (select.aggFn === 'avg') {
    // Sum/Count increase ratio — the same scalar recipe as explicit
    // histograms (exp points carry Count/Sum too). RAW ONLY: there is no exp
    // rollup avg recipe, so the router pins exp avg to raw points (see
    // canUseRollup) and translateExpHistogramRollupV2 keeps throwing.
    return histogramAvgCtesV2({ ...rest, fast, resolved: { temporality } });
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

/** Like expTupleToMap, but with the absolute indices downscaled from
 * `fromScale` to `toScale` (k -> floor(k / 2^(from - to)) — exact bucket
 * algebra, recipe R4). Downscaling collapses neighboring source buckets onto
 * one target index, so the map is built through arrayReduce('sumMap') which
 * merges duplicate keys — mapFromArrays would keep them, and mapSubtract
 * silently mis-merges duplicated keys (verified). With fromScale = toScale
 * this degenerates to expTupleToMap (exp2(0) = 1). */
const expTupleToMapAtScale = (
  tuple: string,
  fromScale: string,
  toScale: string,
) =>
  `CAST(arrayReduce(
    'sumMap',
    [arrayMap(i -> toInt64(floor((${tuple}.2 + i - 1) / exp2(${fromScale} - ${toScale}))), arrayEnumerate(${tuple}.1))],
    [CAST(${tuple}.1, 'Array(Int64)')]
  ), 'Map(Int64, Int64)')`;

/** Downscales an already-built absolute-index bucket map from `fromScale` to
 * `toScale`, merging the collapsed keys (see expTupleToMapAtScale). */
const expMapAtScale = (map: string, fromScale: string, toScale: string) =>
  `CAST(arrayReduce(
    'sumMap',
    [arrayMap(k -> toInt64(floor(k / exp2(${fromScale} - ${toScale}))), mapKeys(${map}))],
    [mapValues(${map})]
  ), 'Map(Int64, Int64)')`;

type ExpBranchArgs = {
  fast?: boolean;
  timeBucketSelect: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
};

/** Delta branch: points are additive across DISTINCT timestamps, but
 * same-(series, ts) rows are OTLP transport retries (re-delivered exports
 * whose rebatched insert blocks evade the exporter's dedup token) — so a
 * per-(series, ts) dedup pass picks the max-Count sample first, then one
 * GROUP BY collapses to (series, display bucket, scale). Still no window
 * sort. Scale stays in the aggregation key — bucket maps are only ever
 * summed within one scale, mirroring the rollup path (R1); the shared tail
 * downscale-merges across scales (R4). */
const deltaExpCtes = ({
  fast,
  timeBucketSelect,
  pointsFrom,
  pointsWhere,
}: ExpBranchArgs): WithClauses => [
  {
    name: 'ExpRaw',
    sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        any(Scale) AS Scale,
        argMax((PositiveBucketCounts, PositiveOffset), Count) AS tpl,
        argMax((NegativeBucketCounts, NegativeOffset), Count) AS ntpl,
        max(toInt64(ZeroCount)) AS zero_count,
        max(ZeroThreshold) AS zt
      FROM ${pointsFrom}
      WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
      GROUP BY SeriesHash, TimeUnix
    `,
  },
  {
    name: 'ExpPerSeries',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        Scale AS scale,
        sumMap(${expTupleToMap('tpl')}) AS pos,
        sumMap(${expTupleToMap('ntpl')}) AS neg,
        sum(zero_count) AS zero,
        max(zt) AS zt
      FROM ExpRaw
      GROUP BY SeriesHash, \`__hdx_time_bucket\`, Scale
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
        zt,
        any(tpl) OVER w AS prev_tpl,
        any(ntpl) OVER w AS prev_ntpl,
        any(Scale) OVER w AS prev_scale,
        any(toNullable(zero_count)) OVER w AS prev_zero,
        any(toNullable(total_count)) OVER w AS prev_total,
        ${'' /* scale renegotiation: an SDK re-bucket changes Scale WITHOUT a Count decrease, so the reset branch never fires — diffing maps across the transition would mix index spaces. Downscale BOTH maps to the pair's min scale before subtracting (what Prometheus native histograms do: CopyToSchema before Sub) and emit the diff AT that scale (eff_scale); the per-eff_scale grouping below plus the shared tail then merge exactly. prev_scale's first-row default (0) is never read: every consumer sits behind the prev_total IS NULL guard. */}
        multiIf(
          prev_total IS NULL, Scale,
          total_count < prev_total, Scale,
          least(Scale, prev_scale)
        ) AS eff_scale,
        ${'' /* first sample emits 0 (canonical rule: a newly-born series' cumulative history is NOT an increase); ONLY a genuine reset (count decrease) credits the full current value. Empty-map arm must match the Map(Int64, Int64) of the other arms exactly or the IF arms collapse into a Variant. */}
        IF(
          prev_total IS NULL,
          CAST(map(), 'Map(Int64, Int64)'),
          IF(
            total_count < prev_total,
            ${expTupleToMap('tpl')},
            mapSubtract(
              ${expTupleToMapAtScale('tpl', 'Scale', 'eff_scale')},
              ${expTupleToMapAtScale('prev_tpl', 'prev_scale', 'eff_scale')}
            )
          )
        ) AS pos_if_cum,
        IF(
          prev_total IS NULL,
          CAST(map(), 'Map(Int64, Int64)'),
          IF(
            total_count < prev_total,
            ${expTupleToMap('ntpl')},
            mapSubtract(
              ${expTupleToMapAtScale('ntpl', 'Scale', 'eff_scale')},
              ${expTupleToMapAtScale('prev_ntpl', 'prev_scale', 'eff_scale')}
            )
          )
        ) AS neg_if_cum,
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
          argMax((NegativeBucketCounts, NegativeOffset), Count) AS ntpl,
          max(toInt64(ZeroCount)) AS zero_count,
          max(toInt64(Count)) AS total_count,
          max(ZeroThreshold) AS zt
        FROM ${pointsFrom}
        WHERE ${pointsWhere}${seriesScanFilter(fast)} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
    `,
  },
  {
    // Grouped per eff_scale (not min(Scale) per bucket): each diff map is
    // internally at ONE scale, and the shared tail's minScale merge handles
    // buckets whose rows span a renegotiation.
    name: 'ExpPerSeries',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        eff_scale AS scale,
        sumMap(pos_if_cum) AS pos,
        sumMap(neg_if_cum) AS neg,
        sum(zero_if_cum) AS zero,
        max(zt) AS zt
      FROM ExpRaw
      GROUP BY SeriesHash, \`__hdx_time_bucket\`, eff_scale
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
    // Same-timestamp duplicates collapse per (series, ts) first — same-ts
    // rows are OTLP transport retries, so BOTH temporality variants read the
    // row with the highest Count (argMax/max — the true sample; a per-ts sum
    // would double-count a delta retry). Delta stays additive across
    // distinct timestamps, summed per display bucket below.
    name: 'ExpRaw',
    sql: chSql`
      SELECT
        TimeUnix,
        \`__hdx_time_bucket\`,
        SeriesHash,
        Scale,
        posMap,
        negMap,
        zero_count,
        total_count,
        zt,
        any(posMap) OVER w AS prev_posMap,
        any(negMap) OVER w AS prev_negMap,
        any(Scale) OVER w AS prev_scale,
        any(toNullable(zero_count)) OVER w AS prev_zero,
        any(toNullable(total_count)) OVER w AS prev_total,
        multiIf(
          prev_total IS NULL, Scale,
          total_count < prev_total, Scale,
          least(Scale, prev_scale)
        ) AS eff_scale,
        ${'' /* first sample emits 0; only a genuine reset credits the full current map; a scale renegotiation downscales both maps to the pair's min scale before diffing (see cumulativeExpCtes) */}
        IF(
          prev_total IS NULL,
          CAST(map(), 'Map(Int64, Int64)'),
          IF(
            total_count < prev_total,
            posMap,
            mapSubtract(
              ${expMapAtScale('posMap', 'Scale', 'eff_scale')},
              ${expMapAtScale('prev_posMap', 'prev_scale', 'eff_scale')}
            )
          )
        ) AS pos_if_cum,
        IF(
          prev_total IS NULL,
          CAST(map(), 'Map(Int64, Int64)'),
          IF(
            total_count < prev_total,
            negMap,
            mapSubtract(
              ${expMapAtScale('negMap', 'Scale', 'eff_scale')},
              ${expMapAtScale('prev_negMap', 'prev_scale', 'eff_scale')}
            )
          )
        ) AS neg_if_cum,
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
          argMax(
            mapFromArrays(
              arrayMap(i -> toInt64(NegativeOffset + i - 1), arrayEnumerate(NegativeBucketCounts)),
              CAST(NegativeBucketCounts, 'Array(Int64)')
            ),
            Count
          ) AS negMap,
          max(toInt64(ZeroCount)) AS zero_count,
          max(toInt64(Count)) AS total_count,
          max(ZeroThreshold) AS zt
        FROM ${pointsFrom}
        WHERE ${pointsWhere} AND ${SERIES_HASH_FILTER} AND ${NOT_STALENESS_MARKER}
        GROUP BY SeriesHash, TimeUnix
      )
      WINDOW w AS (PARTITION BY SeriesHash ORDER BY TimeUnix ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
    `,
  },
  {
    // Delta maps stay at the row's Scale; cumulative diffs sit at eff_scale
    // (= Scale except on a renegotiation transition row). Both scales ride
    // the group key so each variant's maps are summed within one scale; the
    // ExpJoined pick chooses the matching scale column per temporality.
    name: 'ExpPerSeries',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        SeriesHash,
        Scale AS scale_if_delta,
        eff_scale AS scale_if_cum,
        sumMap(posMap) AS pos_if_delta,
        sumMap(pos_if_cum) AS pos_if_cum,
        sumMap(negMap) AS neg_if_delta,
        sumMap(neg_if_cum) AS neg_if_cum,
        sum(zero_count) AS zero_if_delta,
        sum(zero_if_cum) AS zero_if_cum,
        max(zt) AS zt
      FROM ExpRaw
      GROUP BY SeriesHash, \`__hdx_time_bucket\`, Scale, eff_scale
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
 *   delta      → per-(series, ts) dedup collapses transport retries, then
 *                one GROUP BY to (series, display bucket, scale) — no window
 *                sort.
 *   cumulative → per-(series, ts) dedup picks the true counter sample as an
 *                argMax (buckets, offset) TUPLE state; the lag window carries
 *                tuples too, and maps are built only at the differencing
 *                step (a Count decrease marks a reset → full counts,
 *                Prometheus semantics; a Scale change downscales both maps
 *                to the pair's min scale before diffing — an SDK re-bucket
 *                preserves Count, so the reset branch cannot catch it).
 *   undefined  → legacy dual-path shape (both variants per point, chosen by
 *                s.Temporality after the join) — fallback for the
 *                not-a-real-case of mixed temporality under one name.
 *
 * All variants converge on ExpJoined(bucket, group?, scale, chosenMap,
 * chosenNegMap, chosenZero), then the shared tail: ExpScaled (min Scale per
 * group+bucket), source (downscale indices k -> floor(k / 2^d), merge across
 * series), metrics (3-region rank walk over negative/zero/positive buckets —
 * see expQuantileTailCtes).
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
        p.neg AS chosenNegMap,
        p.zero AS chosenZero,
        p.zt AS zt
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
        IF(s.Temporality = 'delta', p.scale_if_delta, p.scale_if_cum) AS scale,
        IF(s.Temporality = 'delta', p.pos_if_delta, p.pos_if_cum) AS chosenMap,
        IF(s.Temporality = 'delta', p.neg_if_delta, p.neg_if_cum) AS chosenNegMap,
        IF(s.Temporality = 'delta', p.zero_if_delta, p.zero_if_cum) AS chosenZero,
        p.zt AS zt
      FROM ExpPerSeries AS p
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash
    `,
  },
  ...expQuantileTailCtes({ groupBy, valueAlias, level }),
];

/**
 * Shared exp-histogram quantile tail. Consumes ExpJoined(bucket, group?,
 * scale, chosenMap, chosenNegMap, chosenZero): ExpScaled finds the min scale
 * per group+bucket, source downscale-merges bucket indices
 * (k -> floor(k / 2^d), exact bucket algebra — recipe R4), metrics ranks and
 * interpolates over the FULL SIGNED distribution (Prometheus native-histogram
 * semantics — AllBucketIterator order):
 *   1. negative buckets, most-negative first (negative index k holds
 *      observations in [-base^(k+1), -base^k), so ascending VALUE order is
 *      DESCENDING index order — the merged arrays are reversed);
 *   2. the zero bucket — LINEAR interpolation inside [lo, zeroWidth] with the
 *      natural lower bound lo = -zeroWidth iff negatives were observed, else 0
 *      (Prometheus promql/quantile.go zero-bucket semantics; zeroWidth is the
 *      max OTLP ZeroThreshold plumbed through the per-series chains). With
 *      zeroWidth = 0 — the SDK default and every producer that never declares
 *      a width — the arm returns exactly 0., bit-identical to the previous
 *      hardcoded arm. The arm divides by zeroTotal and is only reachable when
 *      zeroTotal > 0 (the preceding negative arms and the total > 0 guard
 *      cover the rest), so keep the multiIf arm ORDER exactly as written;
 *   3. positive buckets ascending, interpolated within (base^k, base^(k+1)].
 * In-bucket interpolation is EXPONENTIAL, matching Prometheus 3.x
 * histogram_quantile on native histograms (measured: linear drifted +0.08%
 * side-by-side, worst case +0.376% at scale 2; exponential reproduces
 * Prometheus to 1e-13): positive v = base^(k + frac) (= lo·(hi/lo)^frac),
 * negative v = -base^(k + 1 - frac) (the exponential computed on the
 * magnitudes, negated). CLASSIC explicit-bounds quantiles stay linear —
 * that matches Prometheus's classic histogram_quantile. With no negative
 * observations (negTotal = 0) every branch reduces bit-for-bit to the
 * positive-only walk.
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
        sumMap(
          arrayMap(k -> toInt64(floor(k / exp2(scale - minScale))), mapKeys(chosenNegMap)),
          arrayMap(v -> toInt64(v), mapValues(chosenNegMap))
        ) AS mergedNeg,
        sum(toInt64(chosenZero)) AS zeroTotal,
        max(zt) AS zeroWidth
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
        arrayReverse(mergedNeg.1) AS nks,
        arrayReverse(mergedNeg.2) AS nvs,
        arrayCumSum(vs) AS cum,
        arrayCumSum(nvs) AS ncum,
        arraySum(nvs) AS negTotal,
        negTotal + zeroTotal + arraySum(vs) AS total,
        ${{ Float64: level }} * total AS rank,
        exp2(exp2(-minScale)) AS base,
        arrayFirstIndex(c -> c >= rank, ncum) AS nidx,
        arrayFirstIndex(c -> (c + negTotal + zeroTotal) >= rank, cum) AS idx,
        multiIf(
          negTotal > 0 AND rank <= negTotal AND nidx = 0, -pow(base, nks[length(nks)]), ${'' /* numeric edge: rank at the top of the negative region */}
          negTotal > 0 AND rank <= negTotal AND nvs[nidx] = 0, -pow(base, nks[nidx] + 1),
          negTotal > 0 AND rank <= negTotal, -pow(base, nks[nidx] + 1 - ((rank - if(nidx = 1, 0, ncum[nidx - 1])) / nvs[nidx])),
          rank <= negTotal + zeroTotal,
            if(negTotal > 0, -zeroWidth, 0.)
            + (zeroWidth - if(negTotal > 0, -zeroWidth, 0.))
              * ((rank - negTotal) / zeroTotal),
          idx = 0, pow(base, ks[length(ks)] + 1), ${'' /* numeric edge: rank past the last bucket */}
          vs[idx] = 0, pow(base, ks[idx]),
          pow(base, ks[idx] + ((rank - (negTotal + zeroTotal + if(idx = 1, 0, cum[idx - 1]))) / vs[idx]))
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
      sumMap(SumNegative) AS neg_delta,
      sum(SumZeroCount) AS zero_delta,
      max(ZeroThreshold) AS zt
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
      neg_delta,
      zero_delta,
      zt,
      tupleElement(f, 'PositiveBuckets') AS fPos,
      tupleElement(l, 'PositiveBuckets') AS lPos,
      tupleElement(f, 'NegativeBuckets') AS fNeg,
      tupleElement(l, 'NegativeBuckets') AS lNeg,
      toFloat64(tupleElement(f, 'Count')) AS fCount,
      toFloat64(tupleElement(l, 'Count')) AS lCount,
      toInt64(tupleElement(f, 'ZeroCount')) AS fZero,
      toInt64(tupleElement(l, 'ZeroCount')) AS lZero,
      any(lPos) OVER w AS prevLPos,
      any(lNeg) OVER w AS prevLNeg,
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
      mapAdd(
        IF(
          prevLCount IS NULL,
          CAST(map(), 'Map(Int32, Int64)'),
          IF(
            fCount >= prevLCount,
            mapSubtract(CAST(fNeg, 'Map(Int32, Int64)'), CAST(prevLNeg, 'Map(Int32, Int64)')),
            CAST(fNeg, 'Map(Int32, Int64)')
          )
        ),
        IF(
          lCount >= fCount,
          mapSubtract(CAST(lNeg, 'Map(Int32, Int64)'), CAST(fNeg, 'Map(Int32, Int64)')),
          CAST(lNeg, 'Map(Int32, Int64)')
        )
      ) AS neg_inc_cum,
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
        sumMap(SumNegative) AS neg,
        sum(SumZeroCount) AS zero,
        max(ZeroThreshold) AS zt
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
        sumMap(neg_inc_cum) AS neg,
        sum(zero_inc_cum) AS zero,
        max(zt) AS zt
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
        sumMap(neg_delta) AS neg_if_delta,
        sum(zero_delta) AS zero_if_delta,
        sumMap(pos_inc_cum) AS pos_if_cum,
        sumMap(neg_inc_cum) AS neg_if_cum,
        sum(zero_inc_cum) AS zero_if_cum,
        max(zt) AS zt
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
        p.neg AS chosenNegMap,
        p.zero AS chosenZero,
        p.zt AS zt
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
        IF(s.Temporality = 'delta', CAST(p.neg_if_delta, 'Map(Int32, Int64)'), p.neg_if_cum) AS chosenNegMap,
        IF(s.Temporality = 'delta', toInt64(p.zero_if_delta), p.zero_if_cum) AS chosenZero,
        p.zt AS zt
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
      // Same-timestamp duplicates collapse per (series, ts) first — same-ts
      // rows are OTLP transport retries, so BOTH temporalities take
      // max(Count): cumulative because a lower duplicate must not fire the
      // reset branch, delta because summing would double-count the retry
      // (delta stays additive across distinct timestamps only).
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
          max(toInt64(Count)) AS count_delta`
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
      // lag — same-ts rows are OTLP transport retries, so BOTH temporalities
      // take argMax(BucketCounts, Count) (the row with the true counter
      // state; summing per-ts would double-count a delta retry — delta stays
      // additive across distinct timestamps only).
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
          CAST(argMax(BucketCounts, Count) AS Array(Int64)) AS counts_delta`
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
      // Same-timestamp duplicates collapse per (series, ts) first — same-ts
      // rows are OTLP transport retries, so BOTH temporalities pick
      // argMax(Sum, Count)/max(Count) (the true counter samples; per-ts sums
      // would double-count a delta retry — delta stays additive across
      // distinct timestamps only).
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
          max(toFloat64(Count)) AS c_delta,
          argMax(Sum, Count) AS sm_delta`
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

/**
 * Histogram min/max: the STORED event extremes — min(Min)/max(Max) per
 * (series, display bucket), then folded across series after the label join.
 * No temporality branch and no reset chain: extremes are order- and
 * restart-insensitive (a restart only shrinks the window they cover), and
 * byte-identical transport retries are idempotent under min/max, so no
 * per-(series, ts) dedup pass is needed either. Raw scans keep the Rule-6
 * marker filter (a marker row's Min/Max are meaningless zeros that would
 * poison min()); the 5m/1h tiers' Min/Max are marker-free
 * SimpleAggregateFunction columns with the same names, so one shape serves
 * both paths. Extremes are scalar math — no raw-window cap needed (same
 * class as count/avg).
 *
 * Caveats (schema-inherent, surfaced in the UI labels): the exporter stores
 * 0 when the SDK omits HasMin/HasMax, and CUMULATIVE-temporality extremes
 * cover the window since the series started (i.e. since the last restart),
 * NOT the display bucket — the chart shows "the lifetime extreme as of this
 * bucket". Delta-temporality extremes are true per-bucket extremes.
 */
const histogramExtremeCtesV2 = ({
  fast,
  timeBucketSelect,
  groupBy,
  pointsFrom,
  pointsWhere,
  valueAlias,
  mode,
  rawMarkerFilter,
}: {
  fast?: boolean;
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  pointsFrom: TemplatedInput;
  pointsWhere: TemplatedInput;
  valueAlias: TemplatedInput;
  mode: 'min' | 'max';
  /** Raw points carry Flags (Rule 6); rollup tiers are marker-free. */
  rawMarkerFilter: boolean;
}): WithClauses => [
  {
    name: 'ExtremesPerSeries',
    sql: chSql`
      SELECT
        ${timeBucketSelect},
        SeriesHash,
        ${mode === 'min' ? 'min(Min)' : 'max(Max)'} AS extreme
      FROM ${pointsFrom}
      WHERE ${pointsWhere}${seriesScanFilter(fast)}${
        rawMarkerFilter ? ` AND ${NOT_STALENESS_MARKER}` : ''
      }
      GROUP BY SeriesHash, \`__hdx_time_bucket\`
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        ${mode === 'min' ? 'min(p.extreme)' : 'max(p.extreme)'} AS "${valueAlias}"
      FROM ExtremesPerSeries AS p${
        fast
          ? ''
          : `
      INNER JOIN Series AS s ON p.SeriesHash = s.SeriesHash`
      }
      GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
    `,
  },
];
