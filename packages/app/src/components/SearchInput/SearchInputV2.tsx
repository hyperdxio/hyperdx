import { useEffect, useMemo, useRef, useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Field,
  TableConnection,
  TableConnectionChoice,
} from '@hyperdx/common-utils/dist/core/metadata';
import { genEnglishExplanation } from '@hyperdx/common-utils/dist/queryParser';
import { Group } from '@mantine/core';
import { IconBook } from '@tabler/icons-react';

import {
  ILanguageFormatter,
  useAutoCompleteOptions,
} from '@/hooks/useAutoCompleteOptions';
import { useMetadataWithSettings } from '@/hooks/useMetadata';

import AutocompleteInput from './AutocompleteInput';

import styles from './SearchInputV2.module.scss';

export class LuceneLanguageFormatter implements ILanguageFormatter {
  formatFieldValue(f: Field): string {
    return f.path.join('.');
  }
  formatFieldLabel(f: Field): string {
    return `${f.path.join('.')} (${f.jsType})`;
  }
  formatKeyValPair(key: string, value: string): string {
    return `${key}:"${value}"`;
  }
}

const luceneLanguageFormatter = new LuceneLanguageFormatter();

function stableTableConnectionToKey(tc: TableConnection | undefined): string {
  if (!tc) return '';
  return `${tc.connectionId}|${tc.databaseName}|${tc.tableName}`;
}

export default function SearchInputV2({
  tableConnection,
  tableConnections,
  placeholder = 'Search your events for anything...',
  size = 'sm',
  zIndex,
  language,
  onLanguageChange,
  enableHotkey,
  onSubmit,
  additionalSuggestions,
  queryHistoryType,
  dateRange,
  sourceId,
  'data-testid': dataTestId,
  ...props
}: {
  placeholder?: string;
  size?: 'xs' | 'sm' | 'lg';
  zIndex?: number;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
  enableHotkey?: boolean;
  onSubmit?: () => void;
  additionalSuggestions?: string[];
  queryHistoryType?: string;
  dateRange?: [Date, Date];
  sourceId?: string;
  'data-testid'?: string;
} & UseControllerProps<any> &
  TableConnectionChoice) {
  const {
    field: { onChange, value },
  } = useController(props);

  const metadata = useMetadataWithSettings();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');

  const {
    options: autoCompleteOptions,
    isLoadingValues,
    tokenInfo,
  } = useAutoCompleteOptions(
    luceneLanguageFormatter,
    value != null ? `${value}` : '',
    {
      tableConnection: tableConnection ? tableConnection : tableConnections,
      additionalSuggestions,
      dateRange,
      sourceId,
      inputRef: ref,
    },
  );

  // Callers commonly pass an inline `tcFromSource(source)` for `tableConnection`,
  // which produces a fresh object reference on every parent render. Without
  // stabilizing here, the explanation effect below would re-run continuously,
  // re-triggering schema queries and (when the underlying ClickHouse database
  // doesn't exist) setting the same string state in a tight loop, eventually
  // tripping React's "Maximum update depth exceeded" guard.
  const stableTableConnectionKey = stableTableConnectionToKey(tableConnection);
  const stableTableConnection = useMemo<TableConnection | undefined>(
    () => tableConnection,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableTableConnectionKey],
  );

  useEffect(() => {
    if (!stableTableConnection) return;
    let cancelled = false;
    genEnglishExplanation({
      query: value,
      tableConnection: stableTableConnection,
      metadata,
    })
      .then(q => {
        if (!cancelled) setParsedEnglishQuery(q);
      })
      .catch(err => {
        // Schema lookups can fail for sources whose database/table no longer
        // exists. Swallow these so a stale source doesn't surface as an
        // unhandled rejection that contributes to render-loop crashes.
        console.warn('Failed to compute lucene query explanation:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [value, stableTableConnection, metadata]);

  useHotkeys(
    ['/', 's'],
    () => {
      if (enableHotkey) {
        ref.current?.focus();
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [enableHotkey],
  );

  return (
    <AutocompleteInput
      inputRef={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autocompleteOptions={autoCompleteOptions}
      isLoadingValues={isLoadingValues}
      tokenInfo={tokenInfo}
      size={size}
      zIndex={zIndex}
      language={language}
      onLanguageChange={onLanguageChange}
      onSubmit={onSubmit}
      queryHistoryType={queryHistoryType}
      data-testid={dataTestId}
      aboveSuggestions={
        <>
          <div className={styles.searchingHeader}>Searching for:</div>
          <div className={styles.searchingDescription}>
            {parsedEnglishQuery === ''
              ? 'Matching all events, enter a query to search.'
              : parsedEnglishQuery}
          </div>
        </>
      }
      belowSuggestions={
        <>
          <div className={styles.examplesLabel}>Examples:</div>
          <div className={styles.exampleRow}>
            <span className={styles.exampleLabel}>Full Text:</span>
            <code
              className={styles.exampleCode}
              role="button"
              onClick={() => {
                const newValue =
                  value + (value.length > 0 ? ' ' : '') + 'my log';
                onChange(newValue);
              }}
            >
              my log
            </code>
          </div>

          <div className={styles.exampleRow}>
            <span className={styles.exampleLabel}>Substring:</span>
            <code
              className={styles.exampleCode}
              role="button"
              onClick={() => {
                const newValue =
                  value + (value.length > 0 ? ' ' : '') + '*err*';
                onChange(newValue);
              }}
            >
              *err*
            </code>
          </div>

          <div className={styles.exampleRow}>
            <span className={styles.exampleLabel}>Exact:</span>
            <code
              className={styles.exampleCode}
              role="button"
              onClick={() => {
                const newValue =
                  value + (value.length > 0 ? ' ' : '') + 'level:"info"';
                onChange(newValue);
              }}
            >
              level:{'"'}info{'"'}
            </code>
          </div>

          <div className={styles.exampleRow}>
            <span className={styles.exampleLabel}>Not:</span>
            <code
              className={styles.exampleCode}
              role="button"
              onClick={() => {
                const newValue =
                  value + (value.length > 0 ? ' ' : '') + '-level:info';
                onChange(newValue);
              }}
            >
              -level:info
            </code>
          </div>

          <div className={styles.exampleRow}>
            <span className={styles.exampleLabel}>Existence:</span>
            <code
              className={styles.exampleCode}
              role="button"
              onClick={() => {
                const newValue =
                  value + (value.length > 0 ? ' ' : '') + 'service:*';
                onChange(newValue);
              }}
            >
              service:*
            </code>
          </div>

          <div className={styles.exampleRow}>
            <span className={styles.exampleLabel}>Boolean:</span>
            <code
              className={styles.exampleCode}
              role="button"
              onClick={() => {
                const newValue =
                  value + (value.length > 0 ? ' ' : '') + '("foo" OR "bar")';
                onChange(newValue);
              }}
            >
              (foo OR bar)
            </code>
          </div>

          <a
            className={styles.docsLink}
            target="_blank"
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/search"
            rel="noreferrer"
          >
            <Group gap={5}>
              <IconBook size={14} />
              <span>Docs</span>
            </Group>
          </a>
        </>
      }
    />
  );
}
