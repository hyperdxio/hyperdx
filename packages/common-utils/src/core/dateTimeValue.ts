// Wrap a quoted string literal in a ClickHouse expression whose result type
// matches the date column's type. Shared by the SQL filter emitter
// (filters.ts) and the Lucene serializer's date-column equality/range
// rendering (queryParser.ts) so the two query paths produce byte-identical
// predicates for the same date value.
export const dateTimeValueExpr = (
  chType: string,
  quotedValue: string,
): string => {
  const dt64 = chType.match(/DateTime64\((\d+)/);

  if (dt64) {
    return `parseDateTime64BestEffort(${quotedValue}, ${dt64[1]})`;
  }

  if (/\bDateTime\b/.test(chType)) {
    return `parseDateTimeBestEffort(${quotedValue})`;
  }

  if (/\bDate32\b/.test(chType)) {
    return `toDate32(${quotedValue})`;
  }

  if (/\bDate\b/.test(chType)) {
    return `toDate(${quotedValue})`;
  }

  // Fallback for an unexpected type; DateTime64(9) covers the widest range.
  return `parseDateTime64BestEffort(${quotedValue}, 9)`;
};
