import type { TimelineSeries } from '@hyperdx/common-utils/dist/types';

type SourceInfo = {
  from: { databaseName: string; tableName: string };
  timestampValueExpression: string;
};

function escapeString(s: string): string {
  // Escape backslashes first, then single quotes, so a literal backslash in a
  // label doesn't corrupt the generated SQL string literal.
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function compileEventsSeries(
  series: TimelineSeries,
  source: SourceInfo,
): string {
  const tsExpr = source.timestampValueExpression;
  const table = `\`${source.from.databaseName}\`.\`${source.from.tableName}\``;
  const labelExpr = series.labelExpression || 'Body';
  const groupExpr = series.groupExpression;
  const severityExpr = series.severityExpression;

  const selectParts = [`${tsExpr} AS ts`, `(${labelExpr}) AS label`];

  if (groupExpr) {
    selectParts.push(`(${groupExpr}) AS \`group\``);
  }
  // severity column drives per-marker color (severity > lane color) in the
  // renderer; emit it when the series declares an expression for it.
  if (severityExpr) {
    selectParts.push(`(${severityExpr}) AS severity`);
  }

  selectParts.push(`'${escapeString(series.label)}' AS __series`);

  const whereParts = [
    `${tsExpr} >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})`,
    `${tsExpr} < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})`,
    '$__filters',
  ];

  if (series.where) {
    whereParts.push(`(${series.where})`);
  }

  return `SELECT\n  ${selectParts.join(',\n  ')}\nFROM ${table}\nWHERE ${whereParts.join('\n  AND ')}\nORDER BY ts ASC\nLIMIT 1000`;
}

function compileValueChangeSeries(
  series: TimelineSeries,
  source: SourceInfo,
): string {
  const tsExpr = source.timestampValueExpression;
  const table = `\`${source.from.databaseName}\`.\`${source.from.tableName}\``;
  const trackCol =
    series.trackColumn || "ResourceAttributes['service.version']";
  // groupExpression doubles as the SQL PARTITION BY: each distinct value
  // gets its own version-history sequence so changes are detected per
  // entity (e.g. one history per service.name). Defaulting to ServiceName
  // matches OTel resource conventions.
  const groupExpr = series.groupExpression || 'ServiceName';

  const whereParts = [
    `${tsExpr} >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})`,
    `${tsExpr} < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})`,
    '$__filters',
  ];

  if (series.where) {
    whereParts.push(`(${series.where})`);
  }

  return `SELECT ts, concat(partition_key, ': ', prev_value, ' → ', new_value) AS label, partition_key AS \`group\`, '${escapeString(series.label)}' AS __series
FROM (
  SELECT
    ${tsExpr} AS ts,
    toString(${groupExpr}) AS partition_key,
    toString(${trackCol}) AS new_value,
    lagInFrame(toString(${trackCol}))
      OVER (PARTITION BY ${groupExpr} ORDER BY ${tsExpr}) AS prev_value
  FROM ${table}
  WHERE ${whereParts.join('\n    AND ')}
)
WHERE prev_value != '' AND new_value != '' AND new_value != prev_value
ORDER BY ts ASC
LIMIT 500`;
}

export function compileSingleSeries(
  series: TimelineSeries,
  source: SourceInfo,
): string {
  switch (series.mode) {
    case 'events':
      return compileEventsSeries(series, source);
    case 'value_change':
      return compileValueChangeSeries(series, source);
    default:
      return compileEventsSeries(series, source);
  }
}

// TODO: wire into useQueriedChartConfig so builder-mode timeline tiles generate
// SQL from the series config rather than requiring raw-SQL mode. Until then,
// only raw-SQL timeline tiles produce data; builder configs are stored and
// round-tripped but not compiled at query time.
export function compileTimelineSeries(
  seriesList: TimelineSeries[],
  sources: Map<string, SourceInfo>,
): string {
  if (seriesList.length === 0) return '';

  const compiledQueries: string[] = [];

  for (const series of seriesList) {
    const source = sources.get(series.source);
    if (!source) continue;
    compiledQueries.push(compileSingleSeries(series, source));
  }

  if (compiledQueries.length === 0) return '';

  if (compiledQueries.length === 1) {
    return compiledQueries[0];
  }

  // UNION ALL for multiple series
  return `SELECT * FROM (\n${compiledQueries.join('\n\nUNION ALL\n\n')}\n)\nORDER BY ts ASC`;
}
