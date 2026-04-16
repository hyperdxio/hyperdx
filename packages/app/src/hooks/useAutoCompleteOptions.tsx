import { useMemo } from 'react';
import {
  Field,
  TableConnection,
} from '@hyperdx/common-utils/dist/core/metadata';

import { NOW } from '@/config';
import {
  deduplicate2dArray,
  useCompleteKeyValues,
  useMultipleAllFields,
} from '@/hooks/useMetadata';
import { toArray } from '@/utils';

export type TokenInfo = {
  /** The full token at the cursor position */
  token: string;
  /** Index of the token in the tokens array */
  index: number;
  /** All tokens from splitting the input on whitespace */
  tokens: string[];
};

/** Splits input into tokens and finds which token the cursor is in */
function tokenizeAtCursor(value: string, cursorPos: number): TokenInfo {
  const tokens = value.split(' ');
  let idx = 0;
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    pos += tokens[i].length;
    if (pos >= cursorPos || i === tokens.length - 1) {
      idx = i;
      break;
    }
    pos++; // account for the space
    idx = i + 1;
  }
  return { token: tokens[idx] ?? '', index: idx, tokens };
}

export interface ILanguageFormatter {
  formatFieldValue: (f: Field) => string;
  formatFieldLabel: (f: Field) => string;
  formatKeyValPair: (key: string, value: string) => string;
}

export function useAutoCompleteOptions(
  formatter: ILanguageFormatter,
  value: string,
  {
    tableConnection,
    additionalSuggestions,
    dateRange,
    inputRef,
  }: {
    tableConnection?: TableConnection | TableConnection[];
    additionalSuggestions?: string[];
    dateRange?: [Date, Date];
    inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  },
) {
  const tcs = useMemo(() => toArray(tableConnection), [tableConnection]);

  const effectiveDateRange: [Date, Date] = useMemo(
    () => dateRange ?? [new Date(NOW - 24 * 60 * 60 * 1000), new Date(NOW)],
    [dateRange],
  );

  // Fetch fields, using rollup for map key discovery when available
  const { data: fields } = useMultipleAllFields(tcs, {
    dateRange: effectiveDateRange,
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

  // Tokenize input at cursor position
  const tokenInfo = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    const cursorPos = inputRef?.current?.selectionStart ?? value.length;
    // eslint-disable-next-line react-hooks/refs
    return tokenizeAtCursor(value, cursorPos);
  }, [value, inputRef]);

  // Extract the field name portion of the token (strip colon and value)
  const fieldNameAtCursor = useMemo(() => {
    const colonIdx = tokenInfo.token.indexOf(':');
    return colonIdx >= 0 ? tokenInfo.token.slice(0, colonIdx) : tokenInfo.token;
  }, [tokenInfo.token]);

  // Derive the active search field from the token at cursor
  const searchField = useMemo(
    () => fieldCompleteMap.get(fieldNameAtCursor) ?? null,
    [fieldCompleteMap, fieldNameAtCursor],
  );

  // Debounced fetch of values for the selected key from rollup tables
  const firstTc = tcs.length > 0 ? tcs[0] : undefined;
  const { data: keyValues, isFetching: isLoadingValues } = useCompleteKeyValues(
    {
      tableConnection: firstTc,
      searchField,
      dateRange: effectiveDateRange,
    },
  );

  // Build key-value pair suggestions
  const keyValCompleteOptions = useMemo<
    { value: string; label: string }[]
  >(() => {
    if (!keyValues || !searchField || keyValues.length === 0) return [];

    return keyValues.map(v => {
      const formatted = formatter.formatKeyValPair(
        formatter.formatFieldValue(searchField),
        v,
      );
      return { value: formatted, label: formatted };
    });
  }, [keyValues, searchField, formatter]);

  // Combine all autocomplete options
  const options = useMemo(() => {
    return deduplicate2dArray([fieldCompleteOptions, keyValCompleteOptions]);
  }, [fieldCompleteOptions, keyValCompleteOptions]);

  return { options, isLoadingValues, tokenInfo };
}
