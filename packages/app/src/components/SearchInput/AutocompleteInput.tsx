import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import Fuse from 'fuse.js';
import { Loader, Popover, Textarea, UnstyledButton } from '@mantine/core';

import type { TokenInfo } from '@/hooks/useAutoCompleteOptions';
import { useQueryHistory } from '@/utils';

import InputLanguageSwitch from './InputLanguageSwitch';

import styles from './AutocompleteInput.module.scss';

export default function AutocompleteInput({
  inputRef,
  value,
  onChange,
  placeholder = 'Search your events for anything...',
  autocompleteOptions,
  isLoadingValues,
  tokenInfo,
  size = 'sm',
  aboveSuggestions,
  belowSuggestions,
  showSuggestionsOnEmpty,
  suggestionsHeader = 'Properties',
  zIndex = 999,
  onLanguageChange,
  language,
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
  isLoadingValues?: boolean;
  tokenInfo?: TokenInfo;
  aboveSuggestions?: React.ReactNode;
  belowSuggestions?: React.ReactNode;
  showSuggestionsOnEmpty?: boolean;
  suggestionsHeader?: string;
  zIndex?: number;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
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

  const suggestedProperties = useMemo(() => {
    const token = tokenInfo?.token ?? '';

    if (token.length === 0 && showSuggestionsOnEmpty) {
      return autocompleteOptions ?? [];
    }
    return fuse.search(token).map(result => result.item);
  }, [tokenInfo, fuse, autocompleteOptions, showSuggestionsOnEmpty]);

  const onSelectSearchHistory = (query: string) => {
    setSelectedQueryHistoryIndex(-1);
    onChange(query); // update inputText bar
    setQueryHistory(query); // update history order
    setIsInputDropdownOpen(false); // close dropdown since we execute search
    onSubmit?.(); // search
  };

  const onAcceptSuggestion = (suggestion: string) => {
    setSelectedAutocompleteIndex(-1);

    if (value == null || !tokenInfo) {
      onChange(suggestion);
      inputRef.current?.focus();
      return;
    }

    // Replace the token at cursor with the suggestion
    const tokens = [...tokenInfo.tokens];
    tokens[tokenInfo.index] = suggestion;
    const newValue = tokens.join(' ');

    // Place cursor right after the inserted suggestion
    let newCursorPos = 0;
    for (let i = 0; i <= tokenInfo.index; i++) {
      newCursorPos += tokens[i].length;
      if (i < tokenInfo.index) newCursorPos++; // space
    }

    onChange(newValue);

    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      inputRef.current?.focus();
    });
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

  // Height including the 2px border from .textarea (1px top + 1px bottom)
  const baseHeight = size === 'xs' ? 32 : size === 'lg' ? 44 : 38;

  return (
    <div
      className={styles.root}
      style={{ ['--autocomplete-base-height' as string]: `${baseHeight}px` }}
      data-expanded={isSearchInputFocused ? 'true' : undefined}
    >
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
            className={cx(
              styles.textarea,
              !isSearchInputFocused && styles.collapseFade,
              isSearchInputFocused && styles.focused,
            )}
            value={value}
            size={size}
            autosize
            minRows={1}
            maxRows={isSearchInputFocused ? 4 : 1}
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
              if (
                e.key === 'Escape' &&
                e.target instanceof HTMLTextAreaElement
              ) {
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
                  e.preventDefault();
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
                  e.preventDefault();
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
                    language={language}
                    onLanguageChange={onLanguageChange}
                  />
                </div>
              ) : undefined
            }
          />
        </Popover.Target>
        <Popover.Dropdown className={styles.dropdown}>
          {aboveSuggestions != null && (
            <div className={styles.aboveSuggestions}>{aboveSuggestions}</div>
          )}
          <div>
            {suggestedProperties.length > 0 && (
              <div className={styles.suggestionsSection}>
                <div className={styles.suggestionsHeaderRow}>
                  <div className={styles.suggestionsHeader}>
                    {suggestionsHeader}
                    {isLoadingValues && (
                      <Loader size={12} ml={6} color="var(--color-text)" />
                    )}
                  </div>
                  {suggestedProperties.length > suggestionsLimit && (
                    <div className={styles.suggestionsLimit}>
                      (Showing Top {suggestionsLimit})
                    </div>
                  )}
                </div>
                {suggestedProperties
                  .slice(0, suggestionsLimit)
                  .map(({ value, label }, i) => (
                    <div
                      className={cx(
                        styles.suggestionItem,
                        selectedAutocompleteIndex === i && styles.selected,
                      )}
                      role="button"
                      key={value}
                      onMouseOver={() => {
                        setSelectedAutocompleteIndex(i);
                      }}
                      onClick={() => {
                        onAcceptSuggestion(value);
                      }}
                    >
                      <span className={styles.suggestionLabel}>{label}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
          {belowSuggestions != null && (
            <div className={styles.belowSuggestions}>{belowSuggestions}</div>
          )}
          <div>
            {showSearchHistory && (
              <div className={styles.historySection}>
                <div className={styles.historyTitle}>Search History:</div>
                {queryHistoryList.map(({ value, label }, i) => {
                  return (
                    <UnstyledButton
                      className={cx(
                        styles.historyItem,
                        selectedQueryHistoryIndex === i && styles.selected,
                      )}
                      key={value}
                      onMouseOver={() => setSelectedQueryHistoryIndex(i)}
                      onClick={() => onSelectSearchHistory(value)}
                    >
                      <span className={styles.historyItemLabel}>{label}</span>
                    </UnstyledButton>
                  );
                })}
              </div>
            )}
          </div>
        </Popover.Dropdown>
      </Popover>
    </div>
  );
}
