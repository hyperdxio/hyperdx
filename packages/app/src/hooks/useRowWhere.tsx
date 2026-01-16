import { useCallback, useMemo } from 'react';
import MD5 from 'crypto-js/md5';
import SqlString from 'sqlstring';
import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
  extractColumnReferencesFromKey,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';

const MAX_STRING_LENGTH = 512;

/**
 * Checks if an expression contains references to any of the aliases in the aliasMap.
 * Uses node-sql-parser via extractColumnReferencesFromKey to properly parse the expression
 * and extract column references, avoiding false positives from string literals.
 *
 * For example:
 *   - `concat('text', query_id, 'more')` with alias `query_id` -> true (query_id is a column ref)
 *   - `concat('query_id is here')` with alias `query_id` -> false (query_id is inside a string)
 */
export function expressionContainsAliasReferences(
  expr: string,
  aliasMap: Record<string, string | undefined>,
): boolean {
  try {
    // Extract column references from the expression using node-sql-parser
    const columnRefs = extractColumnReferencesFromKey(expr);

    // Check if any of the referenced columns are aliases
    for (const colRef of columnRefs) {
      if (aliasMap[colRef] != null) {
        return true;
      }
    }

    return false;
  } catch (e) {
    // If parsing fails, fall back to assuming no alias references
    // This is safer than incorrectly detecting references
    console.warn('Failed to parse expression for alias references:', expr, e);
    return false;
  }
}

type ColumnWithMeta = ColumnMetaType & {
  valueExpr: string;
  jsType: JSDataType | null;
  containsAliasRefs: boolean;
};

export function processRowToWhereClause(
  row: Record<string, any>,
  columnMap: Map<string, ColumnWithMeta>,
): string {
  const res = Object.entries(row)
    .map(([column, value]) => {
      const cm = columnMap.get(column);
      const chType = cm?.type;
      const jsType = cm?.jsType;
      const valueExpr = cm?.valueExpr;
      const containsAliasRefs = cm?.containsAliasRefs ?? false;

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

      // If the expression contains alias references that we can't safely expand,
      // skip this column from the WHERE clause to avoid SQL errors.
      // The other columns (especially primary/partition keys) should still
      // provide enough uniqueness for row identification.
      if (containsAliasRefs) {
        return null;
      }

      switch (jsType) {
        case JSDataType.Date:
          return SqlString.format(`?=parseDateTime64BestEffort(?, 9)`, [
            SqlString.raw(valueExpr),
            value,
          ]);
        case JSDataType.Array:
        case JSDataType.Map:
          return SqlString.format(`?=JSONExtract(?, ?)`, [
            SqlString.raw(valueExpr),
            value,
            chType,
          ]);
        case JSDataType.Tuple:
          return SqlString.format(`toJSONString(?)=?`, [
            SqlString.raw(valueExpr),
            value,
          ]);
        case JSDataType.JSON:
          // Handle case for whole json object, ex: json
          return SqlString.format(`lower(hex(MD5(toString(?))))=?`, [
            SqlString.raw(valueExpr),
            MD5(value).toString(),
          ]);
        case JSDataType.Dynamic:
          // Handle case for json element, ex: json.c

          // Currently we can't distinguish null or 'null'
          if (value == null || value === 'null') {
            return SqlString.format(`isNull(??)`, [valueExpr]);
          }
          if (value.length > 1000 || column.length > 1000) {
            console.warn('Search value/object key too large.');
          }
          // TODO: update when JSON type have new version

          // escaped strings needs raw, because sqlString will add another layer of escaping
          // data other than array/object will always return with double quote(because of CH)
          // remove double quote to search correctly.
          // The coalesce is to handle the case when JSONExtract returns null due to the value being a string.
          return SqlString.format(
            "toJSONString(?) = coalesce(toJSONString(JSONExtract(?, 'Dynamic')), toJSONString(?))",
            [SqlString.raw(valueExpr), value, value],
          );

        default:
          // Handle nullish values
          if (value == null) {
            return SqlString.format(`isNull(?)`, [SqlString.raw(valueExpr)]);
          }
          // Handle the case when string is too long
          if (value.length > MAX_STRING_LENGTH) {
            return SqlString.format(
              // We need to slice since md5 can be slow on big payloads
              // which will block the main thread on search table render
              // UTF8 since js only slices in utf8 points, not bytes
              `lower(hex(MD5(leftUTF8(?, 1000))))=?`,
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
    .filter(clause => clause != null)
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

          // Check if this expression contains references to other aliases.
          // If it does, we'll skip this column in the WHERE clause because
          // the alias references won't be resolvable in the row lookup query context.
          // Example: concat('text', query_id, 'more') where query_id is another alias
          const containsAliasRefs =
            aliasMap != null &&
            expressionContainsAliasReferences(valueExpr, aliasMap);

          return [
            c.name,
            {
              ...c,
              valueExpr: valueExpr,
              jsType: convertCHDataTypeToJSType(c.type),
              containsAliasRefs,
            },
          ];
        }),
      ),
    [meta, aliasMap],
  );

  return useCallback(
    (row: Record<string, any>) => {
      // Filter out synthetic columns that aren't in the database schema

      const { __hyperdx_id, ...dbRow } = row;
      return processRowToWhereClause(dbRow, columnMap);
    },
    [columnMap],
  );
}
