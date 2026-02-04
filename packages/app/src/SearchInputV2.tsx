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

import AutocompleteInput from '@/AutocompleteInput';

import {
  ILanguageFormatter,
  useAutoCompleteOptions,
} from './hooks/useAutoCompleteOptions';
import { useMetadataWithSettings } from './hooks/useMetadata';

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
    '/',
    () => {
      if (enableHotkey) {
        ref.current?.focus();
      }
    },
    { preventDefault: true },
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
      showHotkey={enableHotkey}
      onLanguageChange={onLanguageChange}
      onSubmit={onSubmit}
      queryHistoryType={queryHistoryType}
      data-testid={dataTestId}
      aboveSuggestions={
        <>
          <div className="text-muted fs-8 fw-bold me-1">Searching for:</div>
          <div className="text-muted fs-8">
            {parsedEnglishQuery === ''
              ? 'Matching all events, enter a query to search.'
              : parsedEnglishQuery}
          </div>
        </>
      }
      belowSuggestions={
        <>
          <div className="me-2 mb-2 text-light">Examples:</div>
          <div className="mb-2 me-2">
            <span className="me-1">Full Text:</span>
            <code
              className="text-muted bg-highlighted p-1 rounded border border-dark"
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

          <div className="mb-2 me-2">
            <span className="me-1">Substring:</span>
            <code
              className="text-muted bg-highlighted p-1 rounded border border-dark"
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

          <div className="mb-2 me-2">
            <span className="me-1">Exact:</span>
            <code
              className="text-muted bg-highlighted p-1 rounded border border-dark"
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

          <div className="mb-2 me-2">
            <span className="me-1">Not:</span>
            <code
              className="text-muted bg-highlighted p-1 rounded border border-dark"
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

          <div className="mb-2 me-2">
            <span className="me-1">Existence:</span>
            <code
              className="text-muted bg-highlighted p-1 rounded border border-dark"
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

          <div className="mb-2 me-2">
            <span className="me-1">Boolean:</span>
            <code
              className="text-muted bg-highlighted p-1 rounded border border-dark"
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
            className="text-muted mb-2"
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
