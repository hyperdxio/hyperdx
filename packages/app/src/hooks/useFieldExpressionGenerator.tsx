import SqlString from 'sqlstring';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { useJsonColumns } from './useMetadata';

export type FieldExpressionGenerator = (
  /** The column name, either a Map or a JSON column */
  column: string,
  /** The map key or JSON path to access */
  key: string,
  /** Function to convert a Dynamic field from JSON to a non-Dynamic type. Defaults to toString */
  convertFn?: string,
) => string;

/** Utility for rendering SQL field access expressions for Maps and JSON types. */
export default function useFieldExpressionGenerator(
  source: TSource | undefined,
): {
  isLoading: boolean;
  getFieldExpression: FieldExpressionGenerator | undefined;
} {
  const { data: jsonColumns, isLoading: isLoadingJsonColumns } = useJsonColumns(
    tcFromSource(source),
  );

  if (source && !isLoadingJsonColumns) {
    return {
      isLoading: false,
      getFieldExpression: (
        column: string,
        key: string,
        convertFn: string = 'toString',
      ) => {
        const isJson = jsonColumns?.includes(column);
        return isJson
          ? SqlString.format(`${convertFn}(??.??)`, [column, key])
          : SqlString.format('??[?]', [column, key]);
      },
    };
  } else {
    return {
      isLoading: isLoadingJsonColumns,
      getFieldExpression: undefined,
    };
  }
}
