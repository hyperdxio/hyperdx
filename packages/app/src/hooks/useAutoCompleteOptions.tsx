import { useEffect, useMemo, useState } from 'react';
import { Field, TableConnection } from '@hyperdx/common-utils/dist/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import {
  deduplicate2dArray,
  useAllFields,
  useGetKeyValues,
} from '@/hooks/useMetadata';
import { toArray } from '@/utils';

export interface ILanguageFormatter {
  formatFieldValue: (f: Field) => string;
  formatFieldLabel: (f: Field) => string;
  formatKeyValPair: (key: string, value: string) => string;
}

export function useAutoCompleteOptions(
  formatter: ILanguageFormatter,
  value: string,
  {
    tableConnections,
    additionalSuggestions,
  }: {
    tableConnections?: TableConnection | TableConnection[];
    additionalSuggestions?: string[];
  },
) {
  // Fetch and gather all field options
  const { data: fields } = useAllFields(tableConnections ?? [], {
    enabled:
      !!tableConnections &&
      (Array.isArray(tableConnections) ? tableConnections.length > 0 : true),
  });
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
    if (
      !(value as string).startsWith(formatter.formatFieldValue(searchField))
    ) {
      setSearchField(null);
    }
  }, [searchField, setSearchField, value]);
  const searchKeys = useMemo(
    () =>
      searchField
        ? [
            searchField.path.length > 1
              ? `${searchField.path[0]}['${searchField.path[1]}']`
              : searchField.path[0],
          ]
        : [],
    [searchField],
  );

  // hooks to get key values
  const chartConfigs = toArray(tableConnections).map(
    ({ databaseName, tableName, connectionId }) =>
      ({
        connection: connectionId,
        from: {
          databaseName,
          tableName,
        },
        timestampValueExpression: '',
        select: '',
        where: '',
      }) as ChartConfigWithDateRange,
  );
  const { data: keyVals } = useGetKeyValues({
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
  }, [fieldCompleteOptions, keyVals, searchField]);

  // combine all autocomplete options
  return useMemo(() => {
    return deduplicate2dArray([fieldCompleteOptions, keyValCompleteOptions]);
  }, [fieldCompleteOptions, keyValCompleteOptions]);
}
