import { useCallback, useMemo } from 'react';
import MD5 from 'crypto-js/md5';
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

// Internal row field names used by the table component for row tracking
export const INTERNAL_ROW_FIELDS = {
  ID: '__hyperdx_id',
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
          // Handle the case when string is too long
          if (value.length > MAX_STRING_LENGTH) {
            // CH: lower(hex(MD5(leftUTF8(?, 1000)))) — Trino equivalent.
            // `substr(s, 1, 1000)` is char-based in Trino (matches JS's
            // `String.prototype.substring(0, 1000)` for the unicode shapes
            // we care about). The cast-to-varbinary is required by md5().
            return SqlString.format(
              `lower(to_hex(md5(cast(substr(?, 1, 1000) as varbinary))))=?`,
              [
                SqlString.raw(valueExpr),
                MD5(value.substring(0, 1000)).toString(),
              ],
            );
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
