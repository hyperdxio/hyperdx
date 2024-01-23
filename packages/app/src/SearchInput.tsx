import { useEffect, useMemo, useRef, useState } from 'react';

import api from './api';
import AutocompleteInput from './AutocompleteInput';
import { genEnglishExplanation } from './queryv2';

export default function SearchInput({
  inputRef,
  value,
  onChange,
  onSearch,
  placeholder = 'Search your events for anything...',
  showHotkey = true,
  size = 'lg',
  zIndex,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  onSearch: (searchQuery: string) => void;
  placeholder?: string;
  showHotkey?: boolean;
  size?: 'sm' | 'lg';
  zIndex: number;
}) {
  const { data: propertyTypeMappingsResult } = api.usePropertyTypeMappings();
  const propertyTypeMappings = useMemo(() => {
    const mapping = new Map(propertyTypeMappingsResult);

    // TODO: handle special properties somehow better...
    mapping.set('level', 'string');
    mapping.set('service', 'string');
    mapping.set('trace_id', 'string');
    mapping.set('span_id', 'string');
    mapping.set('parent_span_id', 'string');
    mapping.set('span_name', 'string');
    mapping.set('duration', 'number');
    mapping.set('body', 'string');

    return Array.from(mapping?.entries() ?? []).map(([key, type]) => ({
      value: `${key}:`,
      label: `${key} (${type})`,
    }));
  }, [propertyTypeMappingsResult]);

  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');

  useEffect(() => {
    genEnglishExplanation(value).then(q => {
      setParsedEnglishQuery(q);
    });
  }, [value]);

  return (
    <AutocompleteInput
      inputRef={inputRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autocompleteOptions={propertyTypeMappings}
      showHotkey={showHotkey}
      size={size}
      zIndex={zIndex}
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
                onSearch(newValue);
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
                onSearch(newValue);
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
                onSearch(newValue);
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
                onSearch(newValue);
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
                onSearch(newValue);
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
                onSearch(newValue);
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
