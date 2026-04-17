import { useMemo } from 'react';
import {
  Field,
  TableConnection,
} from '@hyperdx/common-utils/dist/core/metadata';

import { NOW } from '@/config';
import {
  deduplicate2dArray,
  useAllKeyValues,
  useMultipleAllFields,
} from '@/hooks/useMetadata';
import { toArray, useDebounce } from '@/utils';

export type TokenInfo = {
  /** The full token at the cursor position */
  token: string;
  /** Index of the token in the tokens array */
  index: number;
  /** All tokens from splitting the input on whitespace */
  tokens: string[];
};

const IDENT_RE = /[A-Za-z0-9_.]/;

function findMatchingQuote(value: string, startIdx: number): number {
  let i = startIdx + 1;
  while (i < value.length) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      i += 2;
      continue;
    }
    if (ch === '"') return i;
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      let k = i;
      while (
        k < value.length &&
        (value[k] === ' ' || value[k] === '\t' || value[k] === '\n')
      )
        k++;
      const identStart = k;
      while (k < value.length && IDENT_RE.test(value[k])) k++;
      if (k > identStart && k < value.length && value[k] === ':') {
        return -1;
      }
    }
    i++;
  }
  return -1;
}

export function tokenizeAtCursor(value: string, cursorPos: number): TokenInfo {
  const tokens: string[] = [];
  // Start offsets of each token in the original string
  const starts: number[] = [];

  let current = '';
  let currentStart = -1;
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (escaped) {
      // Always include the escaped character verbatim (along with its backslash)
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inQuotes) {
      current += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (inQuotes) {
        // Closing an already-opened quoted region.
        if (currentStart === -1) currentStart = i;
        current += ch;
        inQuotes = false;
        continue;
      }
      // Only enter a quoted region if there's a matching close ahead.
      if (findMatchingQuote(value, i) !== -1) {
        if (currentStart === -1) currentStart = i;
        current += ch;
        inQuotes = true;
        continue;
      }
      // Stray/unclosed quote — treat as a literal character.
      if (currentStart === -1) currentStart = i;
      current += ch;
      continue;
    }

    if (!inQuotes && ch === ' ') {
      // Boundary: flush current token (even if empty, to mirror prior `split(' ')`
      // semantics where consecutive spaces produce empty tokens).
      tokens.push(current);
      starts.push(currentStart === -1 ? i : currentStart);
      current = '';
      currentStart = -1;
      continue;
    }

    if (currentStart === -1) currentStart = i;
    current += ch;
  }
  // Flush trailing token
  tokens.push(current);
  starts.push(currentStart === -1 ? value.length : currentStart);

  // Locate token containing the cursor. The cursor sits *between* characters,
  // so a token covers [start, start+len]; we pick the last token whose range
  // contains cursorPos.
  let idx = tokens.length - 1;
  for (let i = 0; i < tokens.length; i++) {
    const start = starts[i];
    const end = start + tokens[i].length;
    if (cursorPos <= end) {
      idx = i;
      break;
    }
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
  _value: string,
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
  const value = useDebounce(_value, 300);
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
  const { data: keyValues, isFetching: isLoadingValues } = useAllKeyValues({
    tableConnection: firstTc,
    searchField,
    dateRange: effectiveDateRange,
  });

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
