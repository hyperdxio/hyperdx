import { ChSql, chSql, concatChSql } from '@/clickhouse';
import { BuilderChartConfig } from '@/types';

import { FIXED_TIME_BUCKET_EXPR_ALIAS } from './renderChartConfig';

type WithClauses = BuilderChartConfig['with'];
type TemplatedInput = ChSql | string;
type HistogramCountInput = {
  timeBucketSelect?: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
};

export const GROUP_ALIAS = 'group';

const renderTimeBucketProjection = (
  timeBucketSelect: TemplatedInput | undefined,
) => (timeBucketSelect ? chSql`${timeBucketSelect},` : chSql``);

const renderChSqlList = (
  list: (TemplatedInput | undefined)[],
  separator: string = ', ',
) =>
  concatChSql(
    separator,
    list.filter(item => item !== undefined).map(item => chSql`${item}`),
  );

const renderOutputDimensions = ({
  timeBucketSelect,
  groupBy,
}: Pick<HistogramCountInput, 'timeBucketSelect' | 'groupBy'>) => {
  const rendered = renderChSqlList(
    [
      timeBucketSelect ? `\`${FIXED_TIME_BUCKET_EXPR_ALIAS}\`` : undefined,
      groupBy ? GROUP_ALIAS : undefined,
    ],
    ',\n',
  );
  return rendered.sql.length > 0 ? chSql`${rendered},` : chSql``;
};

const renderDimensionGroupBy = ({
  timeBucketSelect,
  groupBy,
}: Pick<HistogramCountInput, 'timeBucketSelect' | 'groupBy'>) => {
  const rendered = renderChSqlList([
    timeBucketSelect ? `\`${FIXED_TIME_BUCKET_EXPR_ALIAS}\`` : undefined,
    groupBy ? GROUP_ALIAS : undefined,
  ]);
  return rendered.sql.length > 0 ? chSql`GROUP BY ${rendered}` : chSql``;
};

// SQL expression for hashing metric attributes into a per-series key.
// Variadic cityHash64 over the three attribute scopes — works for both
// Map(LowCardinality(String), String) and JSON columns. Prior to HDX-4466
// the Map-schema path wrapped the three maps in mapConcat() before hashing;
// see the ticket for the cross-scope same-key implications of the switch.
const ATTR_HASH_EXPR =
  'cityHash64(ScopeAttributes, ResourceAttributes, Attributes)';

export const translateHistogram = ({
  select,
  ...rest
}: {
  select: Exclude<BuilderChartConfig['select'], string>[number];
  timeBucketSelect?: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
}) => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level === null)
      throw new Error('quantile must have a level');
    return translateHistogramQuantile({
      ...rest,
      level: select.level,
    });
  }
  if (select.aggFn === 'count') {
    return translateHistogramCount(rest);
  }
  throw new Error(`${select.aggFn} is not supported for histograms currently`);
};

const translateHistogramCount = ({
  timeBucketSelect,
  groupBy,
  from,
  where,
  valueAlias,
}: HistogramCountInput): WithClauses => [
  {
    name: 'source',
    sql: chSql`
        SELECT
            TimeUnix,
            AggregationTemporality,
            ${renderTimeBucketProjection(timeBucketSelect)}
            ${groupBy ? chSql`[${groupBy}] AS ${GROUP_ALIAS},` : ''}
            ${ATTR_HASH_EXPR} AS attr_hash,
            cityHash64(ExplicitBounds) AS bounds_hash,
            toInt64(Count) AS current_count,
            lagInFrame(toNullable(current_count), 1, NULL) OVER (
                PARTITION BY ${groupBy ? `${GROUP_ALIAS}, ` : ''}attr_hash, bounds_hash, AggregationTemporality
                ORDER BY TimeUnix
            ) AS prev_count,
            CASE
                WHEN AggregationTemporality = 1 THEN current_count
                WHEN AggregationTemporality = 2 AND prev_count IS NOT NULL
                  THEN if( ${'' /** When the series resets, take the new current_count as the delta (since it's counting up from 0) */}
                    current_count < prev_count,
                    current_count,
                    current_count - prev_count
                  )
                ELSE 0
            END AS delta
        FROM ${from}
        WHERE ${where}
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
        SELECT
            ${renderOutputDimensions({ timeBucketSelect, groupBy })}
            sum(delta) AS "${valueAlias}"
        FROM source
        ${renderDimensionGroupBy({ timeBucketSelect, groupBy })}
    `,
  },
];

const translateHistogramQuantile = ({
  timeBucketSelect,
  groupBy,
  from,
  where,
  valueAlias,
  level,
}: {
  timeBucketSelect?: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
}): WithClauses => [
  {
    name: 'source',
    sql: chSql`
          SELECT
            MetricName,
            ExplicitBounds,
            ${renderTimeBucketProjection(timeBucketSelect)}
            ${groupBy ? `${GROUP_ALIAS},` : ''}
            sumForEach(deltas) as rates
          FROM (
            SELECT
              TimeUnix,
              MetricName,
              ExplicitBounds,
              ${groupBy ? chSql` ${GROUP_ALIAS},` : ''}
              attr_hash,
              any(attr_hash) OVER prev_row AS prev_attr_hash,
              count() OVER prev_row = 0 OR prev_attr_hash != attr_hash AS is_first_series_point,
              any(bounds_hash) OVER prev_row AS prev_bounds_hash,
              any(counts) OVER prev_row AS prev_counts,
              counts,
              multiIf(
                  AggregationTemporality = 2 AND is_first_series_point, ${'' /** The first point in a cumulative/monotonic series contributes 0 delta */}
                  arrayWithConstant(length(counts), toInt64(0)),

                  AggregationTemporality = 1 ${'' /* denotes a metric that is not monotonic e.g. already a delta */}
                      OR bounds_hash != prev_bounds_hash ${'' /* the bucketing has changed so should be treated as different metric */}
                      OR arrayExists((x) -> x.2 < x.1, arrayZip(prev_counts, counts)), ${'' /* a data point has gone down, probably a reset event */}
                  counts,

                  counts - prev_counts
              ) AS deltas
            FROM (
              SELECT
                  TimeUnix,
                  MetricName,
                  AggregationTemporality,
                  ExplicitBounds,
                  ResourceAttributes,
                  Attributes,${groupBy ? chSql`[${groupBy}] as ${GROUP_ALIAS},` : ''}
                  ${ATTR_HASH_EXPR} AS attr_hash,
                  cityHash64(ExplicitBounds) AS bounds_hash,
                  CAST(BucketCounts AS Array(Int64)) counts
              FROM ${from}
              WHERE ${where}
              ORDER BY ${groupBy ? `${GROUP_ALIAS}, ` : ''}attr_hash, TimeUnix ASC
            )
            WINDOW prev_row AS (
            ${groupBy ? chSql` PARTITION BY ${GROUP_ALIAS}` : ''}
              ORDER BY attr_hash, TimeUnix
              ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING
            )
          )
          GROUP BY ${timeBucketSelect ? chSql`${FIXED_TIME_BUCKET_EXPR_ALIAS},` : ''} MetricName, ${groupBy ? `${GROUP_ALIAS}, ` : ''}ExplicitBounds
          ${timeBucketSelect ? chSql`ORDER BY ${FIXED_TIME_BUCKET_EXPR_ALIAS}` : ''}
          `,
  },
  {
    name: 'points',
    sql: chSql`
          SELECT
            ${renderOutputDimensions({ timeBucketSelect, groupBy })}
            MetricName,
            arrayZipUnaligned(arrayCumSum(rates), ExplicitBounds) as point,
            length(point) as n
          FROM source
          `,
  },
  {
    name: 'metrics',
    sql: chSql`
          SELECT
            ${renderOutputDimensions({ timeBucketSelect, groupBy })}
            MetricName,
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

export const translateExponentialHistogram = ({
  select,
  ...rest
}: {
  select: Exclude<BuilderChartConfig['select'], string>[number];
  timeBucketSelect?: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
}) => {
  if (select.aggFn === 'quantile') {
    if (!('level' in select) || select.level === null)
      throw new Error('quantile must have a level');
    return translateExponentialHistogramQuantile({
      ...rest,
      level: select.level,
    });
  }
  if (select.aggFn === 'count') {
    return translateExponentialHistogramCount(rest);
  }
  throw new Error(
    `${select.aggFn} is not currently supported for exponential histogram metrics`,
  );
};

const translateExponentialHistogramCount = ({
  timeBucketSelect,
  groupBy,
  from,
  where,
  valueAlias,
}: HistogramCountInput): WithClauses => [
  {
    name: 'source',
    sql: chSql`
      SELECT
        MetricName,
        TimeUnix,
        StartTimeUnix,
        AggregationTemporality,
        ${renderTimeBucketProjection(timeBucketSelect)}
        ${groupBy ? chSql`[${groupBy}] AS ${GROUP_ALIAS},` : ''}
        ${ATTR_HASH_EXPR} AS attr_hash,
        toInt64(Count) AS current_count,
        count() OVER prev_row = 0 AS is_first_series_point,
        toInt64(any(Count) OVER prev_row) AS previous_count,
        any(StartTimeUnix) OVER prev_row AS previous_start_time,
        CASE
          WHEN AggregationTemporality = 1 THEN current_count
          WHEN AggregationTemporality = 2 THEN
            multiIf(
              is_first_series_point OR StartTimeUnix = TimeUnix, 0,
              StartTimeUnix != previous_start_time OR current_count < previous_count, current_count,
              current_count - previous_count
            )
          ELSE 0
        END AS delta
      FROM ${from}
      WHERE ${where}
      WINDOW prev_row AS (
        PARTITION BY ${groupBy ? `${GROUP_ALIAS}, ` : ''}MetricName, attr_hash, AggregationTemporality
        ORDER BY TimeUnix
        ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING
      )
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        ${renderOutputDimensions({ timeBucketSelect, groupBy })}
        sum(delta) AS "${valueAlias}"
      FROM source
      ${renderDimensionGroupBy({ timeBucketSelect, groupBy })}
    `,
  },
];

const translateExponentialHistogramQuantile = ({
  timeBucketSelect,
  groupBy,
  from,
  where,
  valueAlias,
  level,
}: {
  timeBucketSelect?: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
  level: number;
}): WithClauses => [
  // Filter for the relevant source data
  {
    name: 'filtered_series',
    sql: chSql`
      SELECT
        MetricName,
        TimeUnix,
        StartTimeUnix,
        AggregationTemporality,
        Scale,
        ${ATTR_HASH_EXPR} AS attr_hash,
        ${groupBy ? chSql`[${groupBy}] as ${GROUP_ALIAS},` : ''}
        ZeroCount,
        PositiveOffset,
        PositiveBucketCounts,
        NegativeOffset,
        NegativeBucketCounts
      FROM ${from}
      WHERE ${where}
    `,
  },
  // Series with non-matching Scales must be normalized to the minimum scale (largest bucket width)
  // so that they can be aggregated together. Consecutive buckets are summed when reducing scale.
  // Buckets are combined by summing their counts. Series already at the normalized scale pass through.
  {
    name: 'series_with_normalized_scale',
    sql: chSql`
      SELECT
        MetricName,
        TimeUnix,
        StartTimeUnix,
        AggregationTemporality,
        normalized_scale AS Scale,
        attr_hash,
        ${groupBy ? `${GROUP_ALIAS},` : ''}
        ZeroCount,
        
        assumeNotNull((SELECT min(Scale) FROM filtered_series)) AS normalized_scale,
        series.Scale - normalized_scale AS scale_shift,
        bitShiftLeft(toInt64(1), scale_shift) AS scale_divisor, ${'' /* 2^scale_shift */}

        ${'' /* Indexes at the normalized scale are floor(index / scale_divisor); right shift floor-divides by 2^scale_shift. */}
        series.PositiveOffset + length(series.PositiveBucketCounts) - 1 AS positive_last_index,
        bitShiftRight(series.PositiveOffset, scale_shift) AS normalized_positive_offset,
        normalized_negative_offset AS NegativeOffset,

        series.NegativeOffset + length(series.NegativeBucketCounts) - 1 AS negative_last_index,
        bitShiftRight(series.NegativeOffset, scale_shift) AS normalized_negative_offset,
        normalized_positive_offset AS PositiveOffset,

        ${'' /* Downscale buckets by splitting at normalized-bucket boundaries (absolute index divisible by scale_divisor) and summing each group */}
        if(
          scale_shift = 0,
          series.PositiveBucketCounts,
          arrayMap(
            bucket_group -> arraySum(bucket_group),
            arraySplit(
              (count, index) -> positiveModulo(index, scale_divisor) = 0,
              series.PositiveBucketCounts,
              range(series.PositiveOffset, positive_last_index + 1)
            )
          )
        ) AS PositiveBucketCounts,

        if(
          scale_shift = 0,
          series.NegativeBucketCounts,
          arrayMap(
            bucket_group -> arraySum(bucket_group),
            arraySplit(
              (count, index) -> positiveModulo(index, scale_divisor) = 0,
              series.NegativeBucketCounts,
              range(series.NegativeOffset, negative_last_index + 1)
            )
          )
        ) AS NegativeBucketCounts
      FROM filtered_series AS series
    `,
  },
  // Normalize cumulative count series to deltas, and pass through
  // delta-temporality series unchanged. UNION the normalized points.
  {
    name: 'normalized_deltas',
    sql: chSql`
      SELECT
        MetricName,
        TimeUnix,
        Scale,
        ${groupBy ? `${GROUP_ALIAS},` : ''}

        ${'' /* Points with no usable predecessor or (StartTimeUnix = TimeUnix) contribute no delta */}
        is_first_series_point OR StartTimeUnix = TimeUnix AS use_zero_counts,

        ${'' /* Changed StartTimeUnix or decreased counts are resets, so the current counts = delta. */}
        NOT use_zero_counts
          AND (
            StartTimeUnix != previous_start_time
            OR current_zero_count < previous_zero_count
            OR positive_counts_decreased
            OR negative_counts_decreased
          ) AS use_current_counts,

        ${'' /** Subtract previous counts from current counts to find the delta values */}
        multiIf(
          use_zero_counts, 0,
          use_current_counts, current_zero_count,
          current_zero_count - previous_zero_count
        ) AS ZeroCount,
        if(
          use_zero_counts,
          emptyArrayInt64(),
          range(
            PositiveOffset,
            PositiveOffset + length(current_positive_bucket_counts)
          )
        ) AS positive_bucket_indexes,
        multiIf(
          use_zero_counts,
          emptyArrayInt64(),
          use_current_counts,
          current_positive_bucket_counts,
          positive_deltas
        ) AS positive_bucket_counts,
        if(
          use_zero_counts,
          emptyArrayInt64(),
          range(
            NegativeOffset,
            NegativeOffset + length(current_negative_bucket_counts)
          )
        ) AS negative_bucket_indexes,
        multiIf(
          use_zero_counts,
          emptyArrayInt64(),
          use_current_counts,
          current_negative_bucket_counts,
          negative_deltas
        ) AS negative_bucket_counts
      FROM (
        SELECT
          MetricName,
          TimeUnix,
          StartTimeUnix,
          Scale,
          attr_hash,
          ${groupBy ? `${GROUP_ALIAS},` : ''}
          PositiveOffset,
          NegativeOffset,

          ${'' /** Cast to Int64 so every multiIf/if branch over these columns in normalized_deltas shares one type; mixing Array(UInt64) with the Int64 delta arrays would otherwise produce a Variant type that breaks sumMap. */}
          toInt64(series.ZeroCount) AS current_zero_count,
          series.PositiveBucketCounts::Array(Int64) AS current_positive_bucket_counts,
          series.NegativeBucketCounts::Array(Int64) AS current_negative_bucket_counts,

          count() OVER prev_row = 0 AS is_first_series_point,
          toInt64(any(series.ZeroCount) OVER prev_row) AS previous_zero_count,
          any(series.StartTimeUnix) OVER prev_row AS previous_start_time,
          any(series.PositiveOffset) OVER prev_row AS previous_positive_offset,
          any(series.NegativeOffset) OVER prev_row AS previous_negative_offset,
          (any(series.PositiveBucketCounts) OVER prev_row)::Array(Int64)
            AS previous_positive_bucket_counts,
          (any(series.NegativeBucketCounts) OVER prev_row)::Array(Int64)
            AS previous_negative_bucket_counts,

          ${'' /** Shift the previous counts to align with the current array's index window (defined by current Offsets) */}
          arrayResize(
            arrayConcat(
              arrayWithConstant(greatest(0, previous_positive_offset - series.PositiveOffset), 0),
              arraySlice(
                previous_positive_bucket_counts,
                1 + greatest(0, series.PositiveOffset - previous_positive_offset)
              )
            ),
            length(current_positive_bucket_counts)
          ) AS aligned_previous_positive_counts,
          arrayResize(
            arrayConcat(
              arrayWithConstant(greatest(0, previous_negative_offset - series.NegativeOffset), 0),
              arraySlice(
                previous_negative_bucket_counts,
                1 + greatest(0, series.NegativeOffset - previous_negative_offset)
              )
            ),
            length(current_negative_bucket_counts)
          ) AS aligned_previous_negative_counts,
          
          ${'' /** Element-wise deltas between current and previous bucket counts */}
          current_positive_bucket_counts - aligned_previous_positive_counts
            AS positive_deltas,
          current_negative_bucket_counts - aligned_previous_negative_counts
            AS negative_deltas,

          ${'' /* A bucket count decreased iff a current count decreased, or a positive previous count was dropped during alignment. */}
          arrayMin(positive_deltas) < 0
            OR arraySum(previous_positive_bucket_counts) > arraySum(aligned_previous_positive_counts)
            AS positive_counts_decreased,
          arrayMin(negative_deltas) < 0
            OR arraySum(previous_negative_bucket_counts) > arraySum(aligned_previous_negative_counts)
            AS negative_counts_decreased
        FROM (
          SELECT *
          FROM series_with_normalized_scale
          WHERE AggregationTemporality = 2
          ${'' /** Keep the input ordering aligned with the prev_row window sort/partition keys. */}
          ORDER BY ${groupBy ? `${GROUP_ALIAS}, ` : ''}MetricName, attr_hash, TimeUnix
        ) AS series
        WINDOW prev_row AS (
          PARTITION BY ${groupBy ? `${GROUP_ALIAS}, ` : ''}MetricName, attr_hash
          ORDER BY TimeUnix
          ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING
        )
      )

      UNION ALL

      ${'' /** Delta-temporality branch: interval counts pass through directly. */}
      SELECT
        MetricName,
        TimeUnix,
        Scale,
        ${groupBy ? `${GROUP_ALIAS},` : ''}
        toUInt8(0) AS use_zero_counts,
        toUInt8(1) AS use_current_counts,
        toInt64(ZeroCount) AS ZeroCount,
        range(
          PositiveOffset,
          PositiveOffset + length(PositiveBucketCounts)
        ) AS positive_bucket_indexes,
        PositiveBucketCounts::Array(Int64) AS positive_bucket_counts,
        range(
          NegativeOffset,
          NegativeOffset + length(NegativeBucketCounts)
        ) AS negative_bucket_indexes,
        NegativeBucketCounts::Array(Int64) AS negative_bucket_counts
      FROM series_with_normalized_scale
      WHERE AggregationTemporality = 1
    `,
  },
  // Sum bucket deltas across series and metric-name aliases for each
  // (time bucket, group) tuple.
  {
    name: 'summed_buckets',
    sql: chSql`
      SELECT
        ${renderTimeBucketProjection(timeBucketSelect)}
        ${groupBy ? `${GROUP_ALIAS},` : ''}
        any(Scale) AS Scale,
        sum(ZeroCount) AS ZeroCount,
        sumMap(positive_bucket_indexes, positive_bucket_counts) AS positive_buckets,
        sumMap(negative_bucket_indexes, negative_bucket_counts) AS negative_buckets
      FROM normalized_deltas
      ${renderDimensionGroupBy({ timeBucketSelect, groupBy })}
    `,
  },
  // Select the bucket containing the requested quantile rank.
  {
    name: 'selected_quantile_buckets',
    sql: chSql`
      SELECT
        ${renderOutputDimensions({ timeBucketSelect, groupBy })}
        Scale,

        ${'' /* Negative, zero, and positive buckets arranged in ascending value order. */}
        length(negative_buckets.1) AS negative_bucket_count,
        arrayConcat(
          arrayReverse(negative_buckets.1),
          [0],
          positive_buckets.1
        ) AS bucket_indexes,
        arrayConcat(
          arrayReverse(negative_buckets.2),
          [ZeroCount],
          positive_buckets.2
        ) AS bucket_counts,
        
        ${'' /* Requested rank and cumulative count at every ordered bucket; the last cumulative count is the total. */}
        arrayCumSum(bucket_counts) AS cumulative_counts,
        cumulative_counts[-1] AS total,
        ${{ Float64: level }} * total AS rank,

        ${'' /* First non-empty bucket containing the requested rank. */}
        arrayFirstIndex(
          (cumulative_count, bucket_count) -> bucket_count > 0 AND cumulative_count >= rank,
          cumulative_counts,
          bucket_counts
        ) AS selected_bucket_position,
        
        ${'' /* The first negative_bucket_count positions hold negative buckets and the next position holds the zero bucket, so the selected side is the sign of the position relative to the zero bucket's position. */}
        sign(selected_bucket_position - negative_bucket_count - 1) AS selected_bucket_side,
        bucket_indexes[selected_bucket_position] AS selected_bucket_index,

        ${'' /* An out-of-range array subscript returns 0, so the first position needs no special case. */}
        (rank - cumulative_counts[selected_bucket_position - 1])
          / bucket_counts[selected_bucket_position] AS fraction_within_bucket
      FROM summed_buckets
      WHERE total > 0 AND selected_bucket_position > 0
    `,
  },
  // Interpolate (log-linear) the quantile within the selected bucket
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        ${renderOutputDimensions({ timeBucketSelect, groupBy })}
        multiIf(
          selected_bucket_side < 0,
          -exp2((selected_bucket_index + 1 - fraction_within_bucket) * exp2(-Scale)),
          selected_bucket_side > 0,
          exp2((selected_bucket_index + fraction_within_bucket) * exp2(-Scale)),
          0 ${'' /* ZeroThreshold is not stored, so the zero bucket represents exactly zero. */}
        ) AS "${valueAlias}"
      FROM selected_quantile_buckets
    `,
  },
];
