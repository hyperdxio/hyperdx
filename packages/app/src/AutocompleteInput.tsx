import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Popover, Textarea, UnstyledButton } from '@mantine/core';

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

  const [isSearchInputFocused, _setIsSearchInputFocused] = useState(false);
  const [isInputDropdownOpen, setIsInputDropdownOpen] = useState(false);
  const setIsSearchInputFocused = useCallback(
    (state: boolean) => {
      _setIsSearchInputFocused(state);
      setIsInputDropdownOpen(state);
    },
    [_setIsSearchInputFocused],
  );
  const [rightSectionWidth, setRightSectionWidth] = useState<number | 'auto'>(
    'auto',
  );
  const [inputWidth, setInputWidth] = useState<number>(720);

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

  const showSearchHistory =
    value != null &&
    value.length === 0 &&
    queryHistoryList.length > 0 &&
    queryHistoryType;

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
  useLayoutEffect(() => {
    if (ref.current) {
      setRightSectionWidth(ref.current.clientWidth);
    }
    if (inputRef.current) {
      setInputWidth(inputRef.current.clientWidth);
    }
  }, [language, onLanguageChange, inputRef]);

  return (
    <Popover
      opened={isInputDropdownOpen}
      onChange={setIsInputDropdownOpen}
      position="bottom-start"
      offset={8}
      width="target"
      withinPortal
      closeOnClickOutside
      closeOnEscape
      styles={{
        dropdown: {
          maxWidth: inputWidth > 300 ? inputWidth : 720,
          width: '100%',
          zIndex,
        },
      }}
    >
      <Popover.Target>
        <Textarea
          ref={inputRef}
          placeholder={placeholder}
          className="fs-8"
          value={value}
          size={size}
          autosize
          minRows={1}
          maxRows={4}
          style={{
            flexGrow: 1,
            resize: 'none',
          }}
          data-testid={dataTestId}
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
            if (e.key === 'Escape' && e.target instanceof HTMLTextAreaElement) {
              e.preventDefault();
              setIsInputDropdownOpen(false);
              e.target.blur();
            }

            // Autocomplete Navigation/Acceptance Keys
            if (e.key === 'Tab' && e.target instanceof HTMLTextAreaElement) {
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
            if (e.key === 'Enter' && e.target instanceof HTMLTextAreaElement) {
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
          rightSectionWidth={rightSectionWidth}
          rightSection={
            language != null && onLanguageChange != null ? (
              <div ref={ref}>
                <InputLanguageSwitch
                  showHotkey={showHotkey && isSearchInputFocused}
                  language={language}
                  onLanguageChange={onLanguageChange}
                />
              </div>
            ) : undefined
          }
        />
      </Popover.Target>
      <Popover.Dropdown className="p-0">
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
                  <UnstyledButton
                    className={`d-block w-100 text-start text-muted fw-normal px-3 py-2 fs-8 ${
                      selectedQueryHistoryIndex === i ? 'bg-muted' : ''
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
      </Popover.Dropdown>
    </Popover>
  );
}
