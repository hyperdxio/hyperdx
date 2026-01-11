import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Popover, TextAreaField } from '@punkbit/cui';

import { useQueryHistory } from '@/utils';

import InputLanguageSwitch from './components/InputLanguageSwitch';
import { useDebounce } from './utils';

export default function AutocompleteInput({
  inputRef,
  value,
  onChange,
  placeholder = 'Search your events for anything...',
  autocompleteOptions,
  size: _size = 'sm',
  aboveSuggestions,
  belowSuggestions,
  showSuggestionsOnEmpty,
  suggestionsHeader = 'Properties',
  zIndex = 999,
  onLanguageChange,
  language,
  showHotkey,
  onSubmit,
  queryHistoryType,
  'data-testid': dataTestId,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value?: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  size?: 'xs' | 'sm' | 'lg';
  autocompleteOptions?: { value: string; label: string }[];
  aboveSuggestions?: React.ReactNode;
  belowSuggestions?: React.ReactNode;
  showSuggestionsOnEmpty?: boolean;
  suggestionsHeader?: string;
  zIndex?: number;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
  showHotkey?: boolean;
  queryHistoryType?: string;
  'data-testid'?: string;
}) {
  const suggestionsLimit = 10;

  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [isInputDropdownOpen, setIsInputDropdownOpen] = useState(false);
  const [showSearchHistory, setShowSearchHistory] = useState(false);

  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] =
    useState(-1);

  const [selectedQueryHistoryIndex, setSelectedQueryHistoryIndex] =
    useState(-1);
  // query search history
  const [queryHistory, setQueryHistory] = useQueryHistory(queryHistoryType);
  const queryHistoryList = useMemo(() => {
    if (!queryHistoryType || !queryHistory) return [];
    return queryHistory.map(q => {
      return {
        value: q,
        label: q,
      };
    });
  }, [queryHistory, queryHistoryType]);

  useEffect(() => {
    if (isSearchInputFocused) {
      setIsInputDropdownOpen(true);
    }
  }, [isSearchInputFocused]);

  useEffect(() => {
    // only show search history when: 1.no input, 2.has search type, 3.has history list
    if (
      value != null &&
      value.length === 0 &&
      queryHistoryList.length > 0 &&
      queryHistoryType
    ) {
      setShowSearchHistory(true);
    } else {
      setShowSearchHistory(false);
    }
  }, [value, queryHistoryType, queryHistoryList]);

  const fuse = useMemo(
    () =>
      new Fuse(autocompleteOptions ?? [], {
        keys: ['value'],
        threshold: 0,
        ignoreLocation: true,
      }),
    [autocompleteOptions],
  );

  const debouncedValue = useDebounce(value ?? '', 200);
  const suggestedProperties = useMemo(() => {
    const tokens = debouncedValue.split(' ');
    const lastToken = tokens[tokens.length - 1];

    if (lastToken.length === 0 && showSuggestionsOnEmpty) {
      return autocompleteOptions ?? [];
    }
    return fuse.search(lastToken).map(result => result.item);
  }, [debouncedValue, fuse, autocompleteOptions, showSuggestionsOnEmpty]);

  const onSelectSearchHistory = (query: string) => {
    setSelectedQueryHistoryIndex(-1);
    onChange(query); // update inputText bar
    setQueryHistory(query); // update history order
    setIsInputDropdownOpen(false); // close dropdown since we execute search
    onSubmit?.(); // search
  };

  const onAcceptSuggestion = (suggestion: string) => {
    setSelectedAutocompleteIndex(-1);

    const newValue =
      value == null
        ? suggestion
        : value.split(' ').slice(0, -1).join(' ') +
          `${value.split(' ').length > 1 ? ' ' : ''}${suggestion}`;
    onChange(newValue);
    inputRef.current?.focus();
  };
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Popover open={isInputDropdownOpen} onOpenChange={setIsInputDropdownOpen}>
        {/* TODO: CLICK-UI-POPOVER-TRIGGER-WIDTH - Popover.Trigger has width: fit-content by default, override to fill flex container */}
        <Popover.Trigger style={{ width: '100%' }}>
          <div style={{ position: 'relative' }}>
            <TextAreaField
              ref={inputRef}
              placeholder={placeholder}
              value={value}
              rows={1}
              className="w-100"
              style={{
                resize: 'none',
              }}
              data-testid={dataTestId}
              onChange={newValue => onChange(newValue)}
              onFocus={() => {
                setSelectedAutocompleteIndex(-1);
                setSelectedQueryHistoryIndex(-1);
                setIsSearchInputFocused(true);
              }}
              onBlur={() => {
                setSelectedAutocompleteIndex(-1);
                setSelectedQueryHistoryIndex(-1);
                setIsSearchInputFocused(false);
              }}
              onKeyDown={e => {
                if (
                  e.key === 'Escape' &&
                  e.target instanceof HTMLTextAreaElement
                ) {
                  e.preventDefault();
                  setIsInputDropdownOpen(false);
                  e.target.blur();
                }

                // Autocomplete Navigation/Acceptance Keys
                if (
                  e.key === 'Tab' &&
                  e.target instanceof HTMLTextAreaElement
                ) {
                  if (
                    suggestedProperties.length > 0 &&
                    selectedAutocompleteIndex < suggestedProperties.length &&
                    selectedAutocompleteIndex >= 0
                  ) {
                    e.preventDefault();
                    onAcceptSuggestion(
                      suggestedProperties[selectedAutocompleteIndex].value,
                    );
                  }
                }
                if (
                  e.key === 'Enter' &&
                  e.target instanceof HTMLTextAreaElement
                ) {
                  if (
                    suggestedProperties.length > 0 &&
                    selectedAutocompleteIndex < suggestedProperties.length &&
                    selectedAutocompleteIndex >= 0
                  ) {
                    e.preventDefault();
                    onAcceptSuggestion(
                      suggestedProperties[selectedAutocompleteIndex].value,
                    );
                  } else {
                    // Allow shift+enter to still create new lines
                    if (!e.shiftKey) {
                      e.preventDefault();
                      if (queryHistoryType && value) {
                        setQueryHistory(value);
                      }
                      onSubmit?.();
                    }
                  }
                }
                if (
                  e.key === 'ArrowDown' &&
                  e.target instanceof HTMLTextAreaElement
                ) {
                  if (suggestedProperties.length > 0) {
                    setSelectedAutocompleteIndex(
                      Math.min(
                        selectedAutocompleteIndex + 1,
                        suggestedProperties.length - 1,
                        suggestionsLimit - 1,
                      ),
                    );
                  }
                }
                if (
                  e.key === 'ArrowUp' &&
                  e.target instanceof HTMLTextAreaElement
                ) {
                  if (suggestedProperties.length > 0) {
                    setSelectedAutocompleteIndex(
                      Math.max(selectedAutocompleteIndex - 1, 0),
                    );
                  }
                }
              }}
            />
            {language != null && onLanguageChange != null && (
              <div
                ref={ref}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                <InputLanguageSwitch
                  showHotkey={showHotkey && isSearchInputFocused}
                  language={language}
                  onLanguageChange={onLanguageChange}
                />
              </div>
            )}
          </div>
        </Popover.Trigger>
        <Popover.Content
          align="start"
          sideOffset={8}
          style={{
            maxWidth:
              (inputRef.current?.clientWidth || 0) > 300
                ? inputRef.current?.clientWidth
                : 720,
            width: inputRef.current?.clientWidth || '100%',
            zIndex,
            padding: 0,
          }}
        >
          {aboveSuggestions != null && (
            <div className="d-flex p-2 flex-wrap px-3">{aboveSuggestions}</div>
          )}
          <div>
            {suggestedProperties.length > 0 && (
              <div className="border-top border-dark fs-8 py-2">
                <div className="d-flex justify-content-between px-3 mb-2">
                  <div className="me-2 text-light">{suggestionsHeader}</div>
                  {suggestedProperties.length > suggestionsLimit && (
                    <div className="text-muted">
                      (Showing Top {suggestionsLimit})
                    </div>
                  )}
                </div>
                {suggestedProperties
                  .slice(0, suggestionsLimit)
                  .map(({ value, label }, i) => (
                    <div
                      className={`py-2 px-3 ${
                        selectedAutocompleteIndex === i ? 'bg-muted' : ''
                      }`}
                      role="button"
                      key={value}
                      onMouseOver={() => {
                        setSelectedAutocompleteIndex(i);
                      }}
                      onClick={() => {
                        onAcceptSuggestion(value);
                      }}
                    >
                      <span className="me-1">{label}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
          {belowSuggestions != null && (
            <div className="border-top px-3 pt-2 pb-1 fs-8 d-flex align-items-center text-muted flex-wrap">
              {belowSuggestions}
            </div>
          )}
          <div>
            {showSearchHistory && (
              <div className="border-top border-dark fs-8 py-2">
                <div className="text-muted fs-8 fw-bold me-1 px-3">
                  Search History:
                </div>
                {queryHistoryList.map(({ value, label }, i) => {
                  return (
                    <button
                      type="button"
                      className={`d-block w-100 text-start text-muted fw-normal px-3 py-2 fs-8 ${
                        selectedQueryHistoryIndex === i ? 'bg-muted' : ''
                      }`}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      key={value}
                      onMouseOver={() => setSelectedQueryHistoryIndex(i)}
                      onClick={() => onSelectSearchHistory(value)}
                    >
                      <span className="me-1 text-truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover>
    </div>
  );
}
