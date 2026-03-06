import { useEffect, useRef, useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Field,
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
  'data-testid'?: string;
} & UseControllerProps<any> &
  TableConnectionChoice) {
  const {
    field: { onChange, value },
  } = useController(props);

  const metadata = useMetadataWithSettings();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');

  const autoCompleteOptions = useAutoCompleteOptions(
    luceneLanguageFormatter,
    value != null ? `${value}` : '',
    {
      tableConnection: tableConnection ? tableConnection : tableConnections,
      additionalSuggestions,
    },
  );

  useEffect(() => {
    if (tableConnection) {
      genEnglishExplanation({
        query: value,
        tableConnection,
        metadata,
      }).then(q => {
        setParsedEnglishQuery(q);
      });
    }
  }, [value, tableConnection, metadata]);

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
