import { useCallback, useMemo } from 'react';
import SqlString from 'sqlstring';
import { BuilderChartConfig } from '@berg/common-utils/dist/types';

import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@/clickhouse-types';

const MAX_STRING_LENGTH = 512;

// Type for WITH clause entries, derived from ChartConfig's with property
export type WithClause = NonNullable<BuilderChartConfig['with']>[number];

// Internal row field names used by the table component for row tracking.
//
// `ID` is the row's WHERE clause — a stable identifier that survives
// requeries and is used for highlighted-line matching and the side-panel
// `rowWhere` URL parameter.  Multiple rendered rows may share an `ID` when
// the row WHERE collapses to the same scalar predicates (e.g. several
// rows in the same `timestamp + service` slice once we drop wide-string
// disambiguators), so it is NOT unique per rendered row.
//
// `EXPANSION_ID` is a per-rendered-row key (`<where>#<index>`) used only
// for inline-expansion state, where collisions cause sibling rows to
// expand together.
export const INTERNAL_ROW_FIELDS = {
  ID: '__hyperdx_id',
  EXPANSION_ID: '__hyperdx_expansion_id',
  ALIAS_WITH: '__hyperdx_alias_with',
} as const;

// Result type for row WHERE clause with alias support
export type RowWhereResult = {
  where: string;
  aliasWith: WithClause[];
};

type ColumnWithMeta = ColumnMetaType & {
  valueExpr: string;
  jsType: JSDataType | null;
};

export function processRowToWhereClause(
  row: Record<string, any>,
  columnMap: Map<string, ColumnWithMeta>,
): string {
  const res = Object.entries(row)
    // Athena/Trino auto-names unaliased SELECT expressions as `_col0`,
    // `_col1`, …  Those names exist only in the query result set, never
    // on the underlying table.  Including them in the row-WHERE turns
    // every row-detail / inline-expand query into a COLUMN_NOT_FOUND
    // error.  The user's row is still uniquely identified by
    // `__hdx_timestamp` (mapped via aliasMap to the source's timestamp
    // column) plus any aliased columns the SELECT actually produced.
    .filter(([column]) => !/^_col\d+$/.test(column))
    .map(([column, value]) => {
      const cm = columnMap.get(column);
      const chType = cm?.type;
      const jsType = cm?.jsType;
      const valueExpr = cm?.valueExpr;

      // Skip complex (json/array/map/tuple/dynamic) columns from the
      // row-WHERE entirely.  The MD5 round-trip we used to do can't be
      // made reliable across Trino's `json_format` and JavaScript's
      // `JSON.stringify` — different canonical forms (key ordering,
      // number stringification, whitespace) silently mean the
      // server-side hash never matches the client-side hash, and the
      // row-detail query returns 0 rows.  The remaining scalar
      // columns (timestamp, service, primary keys, etc.) are enough
      // to identify the row in practice; on the rare collision the
      // row-detail just returns the first match, which is
      // indistinguishable from what the user clicked anyway.
      if (
        jsType === JSDataType.JSON ||
        jsType === JSDataType.Array ||
        jsType === JSDataType.Map ||
        jsType === JSDataType.Tuple ||
        jsType === JSDataType.Dynamic
      ) {
        return null;
      }

      if (chType == null) {
        throw new Error(
          `Column type not found for ${column}, ${JSON.stringify(columnMap)}`,
        );
      }

      if (valueExpr == null) {
        throw new Error(
          `valueExpr not found for ${column}, ${JSON.stringify(columnMap)}`,
        );
      }

      // Handle nullish values for all types uniformly
      if (value == null) {
        return SqlString.format(`? IS NULL`, [SqlString.raw(valueExpr)]);
      }

      switch (jsType) {
        case JSDataType.Date:
          // Trino has no parseDateTime64BestEffort. CAST accepts only the
          // space-separated form (`YYYY-MM-DD HH:mm:ss(.fff)`) and rejects
          // the `Z` zone marker our Athena type-mapper appends to make
          // chart-side `new Date(...)` parse as UTC. Strip the marker and
          // the `T` separator before interpolation so the SQL stays valid.
          return SqlString.format(`?=cast(? as timestamp)`, [
            SqlString.raw(valueExpr),
            String(value).replace('T', ' ').replace(/Z$/, ''),
          ]);

        default:
          // Skip wide string blobs (e.g. `payload`) from the row WHERE.
          // The previous `lower(to_hex(md5(substr(?, 1, 1000)))) = ?`
          // path forced Athena to compute an MD5 over every row in the
          // (timestamp + scalar) slice, adding 5–10 s to row-detail load
          // for no real selectivity gain — the remaining scalar columns
          // (timestamp, service, …) already identify the row in
          // practice and `LIMIT 1` handles the rare collision the same
          // way it does for JSON/Map/Array columns above.
          if (value.length > MAX_STRING_LENGTH) {
            return null;
          }
          return SqlString.format(`?=?`, [
            SqlString.raw(valueExpr), // don't escape expressions
            value,
          ]);
      }
    })
    .filter((clause): clause is string => clause != null)
    .join(' AND ');

  return res;
}

export default function useRowWhere({
  meta,
  aliasMap,
}: {
  meta?: ColumnMetaType[];
  aliasMap?: Record<string, string | undefined>; // map alias -> valueExpr, undefined is not supported
}) {
  const columnMap = useMemo(
    () =>
      new Map(
        meta?.map(c => {
          // if aliasMap is provided, use the alias as the valueExpr
          // but if the alias is not found, use the column name as the valueExpr
          const valueExpr =
            aliasMap != null ? (aliasMap[c.name] ?? c.name) : c.name;

          return [
            c.name,
            {
              ...c,
              valueExpr: valueExpr,
              jsType: convertCHDataTypeToJSType(c.type),
            },
          ];
        }),
      ),
    [meta, aliasMap],
  );

  // CH let `WITH alias AS (expression)` declare expression aliases so a
  // user-typed SELECT like `JSON_PARSE(payload) AS parsed_payload` could
  // be referenced in WHERE by the alias.  Trino's `WITH` is CTE-only;
  // there's no per-expression alias binding.  We don't need it anyway —
  // the column-map below already substitutes the alias's underlying
  // expression directly into the row-WHERE — so `aliasWith` is now an
  // empty list rather than the broken `aliasMapToWithClauses` output
  // that Trino rejected with a SYNTAX_ERROR.
  const aliasWith = useMemo<WithClause[]>(() => [], []);

  return useCallback(
    (row: Record<string, any>): RowWhereResult => {
      // Filter out synthetic columns that aren't in the database schema
      const {
        [INTERNAL_ROW_FIELDS.ID]: _id,
        [INTERNAL_ROW_FIELDS.ALIAS_WITH]: _aliasWith,
        ...dbRow
      } = row;
      return {
        where: processRowToWhereClause(dbRow, columnMap),
        aliasWith,
      };
    },
    [columnMap, aliasWith],
  );
}
