import { useEffect, useMemo, useState } from 'react';
import {
  Field,
  TableConnection,
} from '@hyperdx/common-utils/dist/core/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import {
  deduplicate2dArray,
  useJsonColumns,
  useMultipleAllFields,
  useMultipleGetKeyValues,
} from '@/hooks/useMetadata';
import { mergePath, toArray } from '@/utils';

export interface ILanguageFormatter {
  formatFieldValue: (f: Field) => string;
  formatFieldLabel: (f: Field) => string;
  formatKeyValPair: (key: string, value: string) => string;
}

// Defined outside of the component to fix rerenders
const NOW = Date.now();

export function useAutoCompleteOptions(
  formatter: ILanguageFormatter,
  value: string,
  {
    tableConnection,
    additionalSuggestions,
  }: {
    tableConnection?: TableConnection | TableConnection[];
    additionalSuggestions?: string[];
  },
) {
  // Fetch and gather all field options
  const { data: fields } = useMultipleAllFields(
    tableConnection
      ? Array.isArray(tableConnection)
        ? tableConnection
        : [tableConnection]
      : [],
  );
  const { fieldCompleteOptions, fieldCompleteMap } = useMemo(() => {
    const _columns = (fields ?? []).filter(c => c.jsType !== null);

    const fieldCompleteMap = new Map<string, Field>();
    const baseOptions = _columns.map(c => {
      const val = {
        value: formatter.formatFieldValue(c),
        label: formatter.formatFieldLabel(c),
      };
      fieldCompleteMap.set(val.value, c);
      return val;
    });

    const suggestionOptions =
      additionalSuggestions?.map(column => ({
        value: column,
        label: column,
      })) ?? [];

    const fieldCompleteOptions = [...baseOptions, ...suggestionOptions];

    return { fieldCompleteOptions, fieldCompleteMap };
  }, [formatter, fields, additionalSuggestions]);

  // searchField is used for the purpose of checking if a key is valid and key values should be fetched
  // TODO: Come back and refactor how this works - it's not great and wouldn't catch a person copy-pasting some text
  const [searchField, setSearchField] = useState<Field | null>(null);
  // check if any search field matches
  useEffect(() => {
    const v = fieldCompleteMap.get(value);
    if (v) {
      setSearchField(v);
    }
  }, [fieldCompleteMap, value]);
  // clear search field if no key matches anymore
  useEffect(() => {
    if (!searchField) return;
    if (!value.startsWith(formatter.formatFieldValue(searchField))) {
      setSearchField(null);
    }
  }, [searchField, setSearchField, value, formatter]);
  const tcForJson = Array.isArray(tableConnection)
    ? tableConnection.length > 0
      ? tableConnection[0]
      : undefined
    : tableConnection;
  const { data: jsonColumns } = useJsonColumns(
    tcForJson ?? {
      tableName: '',
      databaseName: '',
      connectionId: '',
    },
  );
  const searchKeys = useMemo(
    () =>
      searchField && jsonColumns
        ? [mergePath(searchField.path, jsonColumns)]
        : [],
    [searchField, jsonColumns],
  );

  // hooks to get key values
  const chartConfigs: ChartConfigWithDateRange[] = toArray(tableConnection).map(
    ({ databaseName, tableName, connectionId }) => ({
      connection: connectionId,
      from: {
        databaseName,
        tableName,
      },
      timestampValueExpression: '',
      select: '',
      where: '',
      // TODO: Pull in date for query as arg
      // just assuming 1/2 day is okay to query over right now
      dateRange: [new Date(NOW - (86400 * 1000) / 2), new Date(NOW)],
    }),
  );
  const { data: keyVals } = useMultipleGetKeyValues({
    chartConfigs,
    keys: searchKeys,
  });
  const keyValCompleteOptions = useMemo<
    { value: string; label: string }[]
  >(() => {
    if (!keyVals || !searchField) return fieldCompleteOptions;
    const output = // TODO: Fix this hacky type assertion caused by bug in HDX-1548
      (
        keyVals as unknown as {
          key: string;
          value: (string | { [key: string]: string })[];
        }[]
      ).flatMap(kv => {
        return kv.value.flatMap(v => {
          if (typeof v === 'string') {
            const value = formatter.formatKeyValPair(
              formatter.formatFieldValue(searchField),
              v,
            );
            return [
              {
                value,
                label: value,
              },
            ];
          } else if (typeof v === 'object') {
            // TODO: Fix type issues mentioned in HDX-1548
            const output: {
              value: string;
              label: string;
            }[] = [];
            for (const [key, val] of Object.entries(v)) {
              if (typeof key !== 'string' || typeof val !== 'string') {
                console.error('unknown type for autocomplete object ', v);
                return [];
              }
              const field = structuredClone(searchField);
              field.path.push(key);
              const value = formatter.formatKeyValPair(
                formatter.formatFieldValue(field),
                val,
              );
              output.push({
                value,
                label: value,
              });
            }
            return output;
          } else {
            return [];
          }
        });
      });
    return output;
  }, [fieldCompleteOptions, keyVals, searchField, formatter]);

  // combine all autocomplete options
  return useMemo(() => {
    return deduplicate2dArray([fieldCompleteOptions, keyValCompleteOptions]);
  }, [fieldCompleteOptions, keyValCompleteOptions]);
}
