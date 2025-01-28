import { useCallback, useMemo } from 'react';
import MD5 from 'crypto-js/md5';
import SqlString from 'sqlstring';

import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@/clickhouse';

const MAX_STRING_LENGTH = 512;

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
          const valueExpr = aliasMap != null ? aliasMap[c.name] : c.name;
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

  return useCallback(
    (row: Record<string, any>) => {
      const res = Object.entries(row)
        .map(([column, value]) => {
          const cm = columnMap.get(column);
          const chType = cm?.type;
          const jsType = cm?.jsType;
          const valueExpr = cm?.valueExpr;

          if (jsType == null || chType == null) {
            throw new Error(
              `Column type not found for ${column}, ${columnMap}`,
            );
          }

          if (valueExpr == null) {
            throw new Error(`valueExpr not found for ${column}, ${columnMap}`);
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
            case JSDataType.JSON:
              // Handle case for whole json object, ex: json
              return SqlString.format(
                `lower(hex(MD5(toString(?))))=?`,
                [
                  SqlString.raw(valueExpr),
                  MD5(value).toString(),
                ],
              );
            case JSDataType.Dynamic:
              // Handle case for json element, ex: json.c

              // Currently we can't distinguish null or 'null'
              if (value === 'null') return SqlString.format(`isNull(??)`, column);
              const columJsonSplit: any = column.split('.');
              if (value.length > 1000 || column.length > 1000 || columJsonSplit.length >= 8) {
                throw new Error('Search value/object key too large, or nested too many level');
              }
              if (columJsonSplit.length >= 2) {
                // case for json.a, really bad implementation
                // reason doing this because at CH
                // {json: {a: [1,2,3]}}
                // json -> '{"a": ["1","2","3"]}}', json.a -> [1,2,3]
                // update this once there is new version
                let jsonExtractTemplate = `simpleJSONExtractRaw(toString(?), ?)`;
                for (let i = 2; i < columJsonSplit.length; i++) {
                  jsonExtractTemplate = 'simpleJSONExtractRaw(' + jsonExtractTemplate + ', ?)'
                }
                jsonExtractTemplate += ' = ?';
                return SqlString.format(jsonExtractTemplate, [
                  SqlString.raw(columJsonSplit[0]),
                  ...(columJsonSplit.slice(1)),
                  value,
                ]);
              } else {
                // case for regular dynamic object
                return SqlString.format(`?=?`, [
                  SqlString.raw(valueExpr),
                  value,
                ]);
              }
              
            default:
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
        .join(' AND ');

      return res;
    },
    [columnMap],
  );
}
