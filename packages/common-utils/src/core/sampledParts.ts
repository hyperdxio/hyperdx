/**
 * Picks a sample of the data parts overlapping a date range, so a per-part
 * read (e.g. a Map keys text index) can skip most parts. The pick runs inside
 * the reading query: part names fetched in an earlier query can merge away
 * before the read.
 *
 * Parts are ranked right-sized first, then too small, then too big, and newest
 * data first within a tier. The sample is the top-ranked parts holding enough
 * rows, the top `ratio` share of parts, and, per string-typed primary key
 * column, parts that add values of that column the others lack, so a sample
 * spans e.g. many ServiceNames rather than one.
 */
import { ChSql, chSql, concatChSql } from '@/clickhouse';

/** Rows inside the date range a part needs to rank ahead of smaller parts. */
const KEY_SAMPLE_MIN_ROWS = 100_000;
// Primary index values are read from at most this many top-ranked parts.
const COVER_POOL_PARTS = 100;
// A column like SpanName or a UUID can add new values in every part.
const COVER_PARTS_PER_COLUMN = 20;
const COVER_VALUES_PER_PART = 1000;

export type SampledPartsOptions = {
  databaseName: string;
  tableName: string;
  dateRange: [Date, Date];
  /** Share of the parts overlapping the range to read. 0 reads the smallest sample. */
  ratio: number;
  /** Parts with more rows than this are read only as a last resort. */
  maxPartRows: number;
  /** String-typed primary key columns whose values the sample should span. */
  coverColumns: string[];
};

// Code constants only, never user input.
const literal = (value: number) => ({ UNSAFE_RAW_SQL: String(value) });

function renderSampleCtes({
  databaseName,
  tableName,
  dateRange,
  maxPartRows,
  coverColumns,
}: SampledPartsOptions): ChSql {
  // est_rows assumes a part's rows are spread evenly over its time span.
  // min_time and max_time have second precision, hence toStartOfSecond.
  const ranked = chSql`
    fromUnixTimestamp64Milli(${{ Int64: dateRange[0].getTime() }}) AS range_start,
    fromUnixTimestamp64Milli(${{ Int64: dateRange[1].getTime() }}) AS range_end,
    ranked AS (
      SELECT name, est_rows, size_tier,
        row_number() OVER w AS rank,
        sum(est_rows) OVER w AS cum_rows,
        count() OVER () AS total_parts
      FROM (
        SELECT name,
          least(max_time, range_end) AS recency,
          rows * (dateDiff('second', greatest(min_time, range_start), least(max_time, range_end)) + 1)
            / (dateDiff('second', min_time, max_time) + 1) AS est_rows,
          multiIf(rows > ${{ Float64: maxPartRows }}, 2, est_rows < ${{ Float64: KEY_SAMPLE_MIN_ROWS }}, 1, 0) AS size_tier
        FROM system.parts
        WHERE database = ${{ String: databaseName }} AND table = ${{ String: tableName }} AND active
          AND max_time >= toStartOfSecond(range_start) AND min_time <= range_end
      )
      WINDOW w AS (ORDER BY size_tier, recency DESC, est_rows DESC, name ROWS UNBOUNDED PRECEDING)
    )`;
  if (coverColumns.length === 0) return chSql`WITH ${ranked}`;

  // Per column, parts holding the most distinct values go first, and a part
  // is kept only if it adds a value no earlier part holds. The primary index
  // records only the first row of each granule, so the values are a subset.
  const values = concatChSql(
    ', ',
    coverColumns.map(
      (column, i) =>
        chSql`(${literal(i)}, toString(${{ Identifier: column }}))`,
    ),
  );
  return chSql`WITH ${ranked},
    cover AS (
      SELECT rank FROM (
        SELECT dim, rank, vals,
          groupUniqArrayArray(vals) OVER (
            PARTITION BY dim ORDER BY length(vals) DESC, rank
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS seen
        FROM (
          SELECT v.1 AS dim, r.rank AS rank, groupUniqArray(${literal(COVER_VALUES_PER_PART)})(v.2) AS vals
          FROM (
            SELECT part_name, arrayJoin([${values}]) AS v
            FROM mergeTreeIndex(${{ String: databaseName }}, ${{ String: tableName }})
            WHERE part_name IN (SELECT name FROM ranked WHERE rank <= ${literal(COVER_POOL_PARTS)} AND size_tier < 2)
          ) AS i
          INNER JOIN ranked AS r ON r.name = i.part_name
          GROUP BY dim, rank
        )
      )
      WHERE NOT hasAll(seen, vals)
      ORDER BY dim, length(vals) DESC, rank
      LIMIT ${literal(COVER_PARTS_PER_COLUMN)} BY dim
    )`;
}

function renderSelected({ ratio, coverColumns }: SampledPartsOptions): ChSql {
  const cover =
    coverColumns.length > 0
      ? chSql` OR rank IN (SELECT rank FROM cover)`
      : chSql``;
  return chSql`(cum_rows - est_rows < ${{ Float64: KEY_SAMPLE_MIN_ROWS }} OR rank <= ${{ Float64: ratio }} * total_parts${cover})`;
}

/** Names of the sampled parts, e.g. for `part_name IN (...)`. */
export function renderSampledPartNames(options: SampledPartsOptions): ChSql {
  return chSql`${renderSampleCtes(options)}
    SELECT name FROM ranked WHERE ${renderSelected(options)}`;
}

/** How many of the parts overlapping the range the sample reads. */
export function renderSampledPartCounts(options: SampledPartsOptions): ChSql {
  return chSql`${renderSampleCtes(options)}
    SELECT countIf(${renderSelected(options)}) AS sampledParts, count() AS totalParts
    FROM ranked`;
}
