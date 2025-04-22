import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { OverlayTrigger } from 'react-bootstrap';
import { TextInput, UnstyledButton } from '@mantine/core';

import { useQueryHistory } from '@/utils';

import InputLanguageSwitch from './components/InputLanguageSwitch';
import { useDebounce } from './utils';

export default function AutocompleteInput({
  inputRef,
  value,
  onChange,
  placeholder = 'Search your events for anything...',
  autocompleteOptions,
  size = 'sm',
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
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string | null;
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
    <OverlayTrigger
      rootClose
      onToggle={opened => {
        // if opened is transitioning to false, but input is focused, ignore it
        if (!opened && isSearchInputFocused) {
          return;
        }

        setIsInputDropdownOpen(opened);
      }}
      show={isInputDropdownOpen}
      placement="bottom-start"
      delay={{ show: 0, hide: 0 }}
      overlay={({ style, ...props }) => (
        <div
          className="bg-body border border-dark rounded"
          style={{
            ...style,
            maxWidth:
              (inputRef.current?.clientWidth || 0) > 300
                ? inputRef.current?.clientWidth
                : 720,
            width: '100%',
            zIndex,
          }}
          {...props}
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
                        selectedAutocompleteIndex === i ? 'bg-hdx-dark' : ''
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
            <div className="border-top border-dark bg-body px-3 pt-2 pb-1 mt-2 fs-8 d-flex align-items-center text-muted flex-wrap">
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
                    <UnstyledButton
                      className={`d-block w-100 text-start text-muted fw-normal px-3 py-2 fs-8 ${
                        selectedQueryHistoryIndex === i ? 'bg-hdx-dark' : ''
                      }`}
                      key={value}
                      onMouseOver={() => setSelectedQueryHistoryIndex(i)}
                      onClick={() => onSelectSearchHistory(value)}
                    >
                      <span className="me-1 text-truncate">{label}</span>
                    </UnstyledButton>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      popperConfig={{
        modifiers: [
          {
            name: 'offset',
            options: {
              offset: [0, 8],
            },
          },
        ],
      }}
      trigger={[]}
    >
      <TextInput
        ref={inputRef}
        type="text"
        style={{ flexGrow: 1 }}
        placeholder={placeholder}
        className="border-0 fs-8"
        value={value}
        size={size}
        onChange={e => onChange(e.target.value)}
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
          if (e.key === 'Escape' && e.target instanceof HTMLInputElement) {
            e.target.blur();
          }

          // Autocomplete Navigation/Acceptance Keys
          if (e.key === 'Tab' && e.target instanceof HTMLInputElement) {
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
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            if (
              suggestedProperties.length > 0 &&
              selectedAutocompleteIndex < suggestedProperties.length &&
              selectedAutocompleteIndex >= 0
            ) {
              onAcceptSuggestion(
                suggestedProperties[selectedAutocompleteIndex].value,
              );
            } else {
              if (queryHistoryType) {
                setQueryHistory(value);
              }
              onSubmit?.();
            }
          }
          if (e.key === 'ArrowDown' && e.target instanceof HTMLInputElement) {
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
          if (e.key === 'ArrowUp' && e.target instanceof HTMLInputElement) {
            if (suggestedProperties.length > 0) {
              setSelectedAutocompleteIndex(
                Math.max(selectedAutocompleteIndex - 1, 0),
              );
            }
          }
        }}
        rightSectionWidth={ref.current?.clientWidth ?? 'auto'}
        rightSection={
          <div ref={ref}>
            {language != null && onLanguageChange != null && (
              <InputLanguageSwitch
                showHotkey={showHotkey && isSearchInputFocused}
                language={language}
                onLanguageChange={onLanguageChange}
              />
            )}
          </div>
        }
      />
    </OverlayTrigger>
  );
}
