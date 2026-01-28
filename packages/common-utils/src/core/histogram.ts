import { ChSql, chSql } from '@/clickhouse';
import { ChartConfig } from '@/types';

type WithClauses = ChartConfig['with'];
type TemplatedInput = ChSql | string;

export const translateHistogram = ({
  select,
  ...rest
}: {
  select: Exclude<ChartConfig['select'], string>[number];
  timeBucketSelect: TemplatedInput;
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
  if (select.aggFn === 'apdex') {
    if (!('threshold' in select) || select.threshold == null) {
      throw new Error('apdex must have a threshold');
    }
    return translateHistogramApdex({
      ...rest,
      threshold: select.threshold,
    });
  }
  throw new Error(`${select.aggFn} is not supported for histograms currently`);
};

const translateHistogramCount = ({
  timeBucketSelect,
  groupBy,
  from,
  where,
  valueAlias,
}: {
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => [
  {
    name: 'source',
    sql: chSql`
        SELECT
            TimeUnix,
            AggregationTemporality,
            ${timeBucketSelect},
            ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
            cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS attr_hash,
            cityHash64(ExplicitBounds) AS bounds_hash,
            toInt64(Count) AS current_count,
            lagInFrame(toNullable(current_count), 1, NULL) OVER (
                PARTITION BY ${groupBy ? `group, ` : ''} attr_hash, bounds_hash, AggregationTemporality
                ORDER BY TimeUnix
            ) AS prev_count,
            CASE
                WHEN AggregationTemporality = 1 THEN current_count
                WHEN AggregationTemporality = 2 THEN greatest(0, current_count - coalesce(prev_count, 0))
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
            \`__hdx_time_bucket\`,
            ${groupBy ? 'group,' : ''}
            sum(delta) AS "${valueAlias}"
        FROM source
        GROUP BY ${groupBy ? 'group, ' : ''}\`__hdx_time_bucket\`
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
  timeBucketSelect: TemplatedInput;
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
            ${timeBucketSelect},
            ${groupBy ? chSql`[${groupBy}] as group,` : ''}
            sumForEach(deltas) as rates
          FROM (
            SELECT
              TimeUnix,
              MetricName,
              ResourceAttributes,
              Attributes,
              ExplicitBounds,
              attr_hash,
              any(attr_hash) OVER (ROWS BETWEEN 1 preceding AND 1 preceding) AS prev_attr_hash,
              any(bounds_hash) OVER (ROWS BETWEEN 1 preceding AND 1 preceding) AS prev_bounds_hash,
              any(counts) OVER (ROWS BETWEEN 1 preceding AND 1 preceding) AS prev_counts,
              counts,
              IF(
                  AggregationTemporality = 1 ${'' /* denotes a metric that is not monotonic e.g. already a delta */}
                      OR prev_attr_hash != attr_hash ${'' /* the attributes have changed so this is a different metric */}
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
                  Attributes,
                  cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS attr_hash,
                  cityHash64(ExplicitBounds) AS bounds_hash,
                  CAST(BucketCounts AS Array(Int64)) counts
              FROM ${from}
              WHERE ${where}
              ORDER BY attr_hash, TimeUnix ASC
            )
          )
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

export const translateHistogramApdex = ({
  threshold,
  timeBucketSelect,
  groupBy,
  from,
  where,
  valueAlias,
}: {
  threshold: number;
  timeBucketSelect: TemplatedInput;
  groupBy?: TemplatedInput;
  from: TemplatedInput;
  where: TemplatedInput;
  valueAlias: TemplatedInput;
}): WithClauses => [
  {
    name: 'source',
    sql: chSql`
      SELECT
        ExplicitBounds,
        ${timeBucketSelect},
        ${groupBy ? chSql`[${groupBy}] AS group,` : ''}
        sumForEach(deltas) AS bucket_counts,
        ${{ Float64: threshold }} AS threshold
      FROM (
        SELECT
          TimeUnix,
          AggregationTemporality,
          ExplicitBounds,
          ResourceAttributes,
          Attributes,
          attr_hash,
          any(attr_hash) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS prev_attr_hash,
          any(bounds_hash) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS prev_bounds_hash,
          any(counts) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS prev_counts,
          counts,
          IF(
            AggregationTemporality = 1
              OR prev_attr_hash != attr_hash
              OR bounds_hash != prev_bounds_hash
              OR arrayExists((x) -> x.2 < x.1, arrayZip(prev_counts, counts)),
            counts,
            counts - prev_counts
          ) AS deltas
        FROM (
          SELECT
            TimeUnix,
            AggregationTemporality,
            ExplicitBounds,
            ResourceAttributes,
            Attributes,
            cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS attr_hash,
            cityHash64(ExplicitBounds) AS bounds_hash,
            CAST(BucketCounts AS Array(Int64)) AS counts
          FROM ${from}
          WHERE ${where}
          ORDER BY attr_hash, TimeUnix ASC
        )
      )
      GROUP BY \`__hdx_time_bucket\`, ${groupBy ? 'group, ' : ''}ExplicitBounds
      ORDER BY \`__hdx_time_bucket\`
    `,
  },
  {
    name: 'metrics',
    sql: chSql`
      SELECT
        \`__hdx_time_bucket\`,
        ${groupBy ? 'group,' : ''}
        arrayResize(ExplicitBounds, length(bucket_counts), inf) AS safe_bounds,
        arraySum((delta, bound) -> if(bound <= threshold, delta, 0), bucket_counts, safe_bounds) AS satisfied,
        arraySum((delta, bound) -> if(bound > threshold AND bound <= (threshold * 4), delta, 0), bucket_counts, safe_bounds) AS tolerating,
        arraySum((delta, bound) -> if(bound > (threshold * 4), delta, 0), bucket_counts, safe_bounds) AS frustrated,
        if(
          satisfied + tolerating + frustrated > 0,
          (satisfied + tolerating * 0.5) / (satisfied + tolerating + frustrated),
          NULL
        ) AS "${valueAlias}"
      FROM source
    `,
  },
];
