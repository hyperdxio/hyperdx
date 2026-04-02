/**
 * Row WHERE clause builder.
 *
 * @source packages/app/src/hooks/useRowWhere.tsx
 *
 * Generates a WHERE clause to uniquely identify a row for a SELECT * lookup.
 * Uses column metadata + alias map to resolve aliased column names back to
 * actual ClickHouse expressions, with proper type handling for each column.
 *
 * This file uses the same exports as the web frontend so it can be moved
 * to common-utils later.
 */

import MD5 from 'crypto-js/md5';
import SqlString from 'sqlstring';
import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import type { BuilderChartConfig } from '@hyperdx/common-utils/dist/types';

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
  row: Record<string, unknown>,
  columnMap: Map<string, ColumnWithMeta>,
): string {
  const res = Object.entries(row)
    .map(([column, value]) => {
      const cm = columnMap.get(column);
      const chType = cm?.type;
      const jsType = cm?.jsType;
      const valueExpr = cm?.valueExpr;

      if (chType == null) {
        throw new Error(
          `Column type not found for ${column}, ${JSON.stringify([...columnMap])}`,
        );
      }

      if (valueExpr == null) {
        throw new Error(
          `valueExpr not found for ${column}, ${JSON.stringify([...columnMap])}`,
        );
      }

      const strValue = value != null ? String(value) : null;

      switch (jsType) {
        case JSDataType.Date:
          return SqlString.format(`?=parseDateTime64BestEffort(?, 9)`, [
            SqlString.raw(valueExpr),
            strValue,
          ]);
        case JSDataType.Array:
        case JSDataType.Map:
          return SqlString.format(`?=JSONExtract(?, ?)`, [
            SqlString.raw(valueExpr),
            strValue,
            chType,
          ]);
        case JSDataType.Tuple:
          return SqlString.format(`toJSONString(?)=?`, [
            SqlString.raw(valueExpr),
            strValue,
          ]);
        case JSDataType.JSON:
          // Handle case for whole json object, ex: json
          return SqlString.format(`lower(hex(MD5(toString(?))))=?`, [
            SqlString.raw(valueExpr),
            MD5(strValue ?? '').toString(),
          ]);
        case JSDataType.Dynamic:
          // Handle case for json element, ex: json.c
          // Currently we can't distinguish null or 'null'
          if (value == null || strValue === 'null') {
            return SqlString.format(`isNull(??)`, [valueExpr]);
          }
          if ((strValue?.length ?? 0) > 1000 || column.length > 1000) {
            console.warn('Search value/object key too large.');
          }
          return SqlString.format(
            "toJSONString(?) = coalesce(toJSONString(JSONExtract(?, 'Dynamic')), toJSONString(?))",
            [SqlString.raw(valueExpr), strValue, strValue],
          );

        default:
          // Handle nullish values
          if (value == null) {
            return SqlString.format(`isNull(?)`, [SqlString.raw(valueExpr)]);
          }
          // Handle the case when string is too long
          if ((strValue?.length ?? 0) > MAX_STRING_LENGTH) {
            return SqlString.format(`lower(hex(MD5(leftUTF8(?, 1000))))=?`, [
              SqlString.raw(valueExpr),
              MD5((strValue ?? '').substring(0, 1000)).toString(),
            ]);
          }
          return SqlString.format(`?=?`, [
            SqlString.raw(valueExpr), // don't escape expressions
            strValue,
          ]);
      }
    })
    .join(' AND ');

  return res;
}

/**
 * Build a column map from query metadata and alias map.
 * This is the non-React equivalent of the useRowWhere hook.
 */
export function buildColumnMap(
  meta: ColumnMetaType[] | undefined,
  aliasMap: Record<string, string | undefined> | undefined,
): Map<string, ColumnWithMeta> {
  return new Map(
    meta?.map(c => {
      // if aliasMap is provided, use the alias as the valueExpr
      // but if the alias is not found, use the column name as the valueExpr
      const valueExpr =
        aliasMap != null ? (aliasMap[c.name] ?? c.name) : c.name;

      return [
        c.name,
        {
          ...c,
          valueExpr,
          jsType: convertCHDataTypeToJSType(c.type),
        },
      ];
    }),
  );
}

/**
 * Build aliasWith array from aliasMap.
 */
export function buildAliasWith(
  aliasMap: Record<string, string | undefined> | undefined,
): WithClause[] {
  return aliasMapToWithClauses(aliasMap) ?? [];
}

/**
 * Generate a RowWhereResult from a row, column map, and alias map.
 * Non-React equivalent of the useRowWhere hook's returned callback.
 */
export function getRowWhere(
  row: Record<string, unknown>,
  columnMap: Map<string, ColumnWithMeta>,
  aliasMap: Record<string, string | undefined> | undefined,
): RowWhereResult {
  // Filter out synthetic columns that aren't in the database schema
  const {
    [INTERNAL_ROW_FIELDS.ID]: _id,
    [INTERNAL_ROW_FIELDS.ALIAS_WITH]: _aliasWith,
    ...dbRow
  } = row;
  return {
    where: processRowToWhereClause(dbRow, columnMap),
    aliasWith: buildAliasWith(aliasMap),
  };
}
