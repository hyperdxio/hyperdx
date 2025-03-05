import { useEffect, useMemo, useRef, useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import { genEnglishExplanation } from '@hyperdx/common-utils/dist/queryParser';

import AutocompleteInput from '@/AutocompleteInput';
import { useAllFields } from '@/hooks/useMetadata';

export default function SearchInputV2({
  database,
  placeholder = 'Search your events for anything...',
  size = 'sm',
  table,
  zIndex,
  language,
  onLanguageChange,
  connectionId,
  enableHotkey,
  onSubmit,
  additionalSuggestions,
  ...props
}: {
  database?: string;
  placeholder?: string;
  size?: 'xs' | 'sm' | 'lg';
  table?: string;
  connectionId: string | undefined;
  zIndex?: number;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
  enableHotkey?: boolean;
  onSubmit?: () => void;
  additionalSuggestions?: string[];
} & UseControllerProps<any>) {
  const {
    field: { onChange, value },
  } = useController(props);

  const ref = useRef<HTMLInputElement>(null);

  const { data: fields } = useAllFields(
    {
      databaseName: database ?? '',
      tableName: table ?? '',
      connectionId: connectionId ?? '',
    },
    {
      enabled: !!database && !!table && !!connectionId,
    },
  );

  const autoCompleteOptions = useMemo(() => {
    const _columns = (fields ?? []).filter(c => c.jsType !== null);
    const baseOptions = _columns.map(c => ({
      value: c.path.join('.'),
      label: `${c.path.join('.')} (${c.jsType})`,
    }));

    const suggestionOptions =
      additionalSuggestions?.map(column => ({
        value: column,
        label: column,
      })) ?? [];

    return [...baseOptions, ...suggestionOptions];
  }, [fields, additionalSuggestions]);

  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');

  useEffect(() => {
    genEnglishExplanation(value).then(q => {
      setParsedEnglishQuery(q);
    });
  }, [value]);

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
              className="text-muted bg-body p-1 rounded border border-dark"
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
              className="text-muted bg-body p-1 rounded border border-dark"
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
              className="text-muted bg-body p-1 rounded border border-dark"
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
              className="text-muted bg-body p-1 rounded border border-dark"
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
              className="text-muted bg-body p-1 rounded border border-dark"
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
              className="text-muted bg-body p-1 rounded border border-dark"
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

          <div className="mb-2 me-2">
            <a
              className="text-muted"
              target="_blank"
              href="https://hyperdx.io/docs/search#search-syntax"
              rel="noreferrer"
            >
              <i className="bi bi-book me-1" />
              <span className="me-1">Docs</span>
            </a>
          </div>
        </>
      }
    />
  );
}
