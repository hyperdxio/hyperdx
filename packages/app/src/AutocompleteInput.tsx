import { useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { OverlayTrigger } from 'react-bootstrap';
import { TextInput } from '@mantine/core';
import { IconFunction, IconHash, IconTable, IconSearch } from '@tabler/icons-react';

import InputLanguageSwitch from './components/InputLanguageSwitch';
import { useDebounce } from './utils';

type SuggestionType = 'function' | 'field' | 'value' | 'search';

interface Suggestion {
  value: string;
  label: string;
  type: SuggestionType;
}

const SEARCH_FUNCTIONS: Suggestion[] = [
  {
    value: 'startsWith("")',
    label: 'startsWith() - Match if field starts with text',
    type: 'function',
  },
  {
    value: 'endsWith("")',
    label: 'endsWith() - Match if field ends with text',
    type: 'function',
  },
  {
    value: 'contains("")',
    label: 'contains() - Match if field contains text',
    type: 'function',
  },
  {
    value: 'matches("")',
    label: 'matches() - Exact match for text',
    type: 'function',
  },
  {
    value: 'hasWord("")',
    label: 'hasWord() - Match whole word',
    type: 'function',
  },
];

const SuggestionIcon = ({ type }: { type: SuggestionType }) => {
  switch (type) {
    case 'function':
      return <IconFunction size={16} className="text-primary me-2" />;
    case 'field':
      return <IconTable size={16} className="text-success me-2" />;
    case 'value':
      return <IconHash size={16} className="text-warning me-2" />;
    case 'search':
      return <IconSearch size={16} className="text-info me-2" />;
    default:
      return null;
  }
};

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
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  size?: 'sm' | 'lg';
  autocompleteOptions?: Suggestion[];
  aboveSuggestions?: React.ReactNode;
  belowSuggestions?: React.ReactNode;
  showSuggestionsOnEmpty?: boolean;
  suggestionsHeader?: string;
  zIndex?: number;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
  showHotkey?: boolean;
}) {
  const suggestionsLimit = 10;

  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [isInputDropdownOpen, setIsInputDropdownOpen] = useState(false);

  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] =
    useState(-1);

  useEffect(() => {
    if (isSearchInputFocused) {
      setIsInputDropdownOpen(true);
    }
  }, [isSearchInputFocused]);

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
    const colonIndex = lastToken.indexOf(':');

    // If we have a colon, show function suggestions
    if (colonIndex !== -1) {
      const field = lastToken.substring(0, colonIndex);
      const searchTerm = lastToken.substring(colonIndex + 1).toLowerCase();
      
      // Only show function suggestions if user hasn't started typing a function
      if (!searchTerm.includes('(')) {
        const filteredFunctions = SEARCH_FUNCTIONS.filter(func => 
          // Remove the () and quotes to match just the function name
          func.value.replace(/\(""\)$/, '').toLowerCase().startsWith(searchTerm)
        );
        
        return filteredFunctions.map(func => ({
          value: `${field}:${func.value}`,
          label: func.label,
          type: func.type,
        }));
      }
    }

    if (lastToken.length === 0 && showSuggestionsOnEmpty) {
      return autocompleteOptions ?? [];
    }
    return fuse.search(lastToken).map(result => result.item);
  }, [debouncedValue, fuse, autocompleteOptions, showSuggestionsOnEmpty]);

  const onAcceptSuggestion = (suggestion: string) => {
    setSelectedAutocompleteIndex(-1);

    let newValue = value.split(' ').slice(0, -1).join(' ') +
      `${value.split(' ').length > 1 ? ' ' : ''}${suggestion}`;
    
    // Position cursor inside function parentheses if it's a function
    if (suggestion.includes('("")')) {
      const cursorPosition = newValue.lastIndexOf('""');
      if (cursorPosition !== -1) {
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = cursorPosition + 1;
            inputRef.current.selectionEnd = cursorPosition + 1;
          }
        }, 0);
      }
    }

    onChange(newValue);
    inputRef.current?.focus();
  };

  return (
    <div style={{ flexGrow: 1 }} className="d-flex align-items-center gap-2">
      <div style={{ flexGrow: 1 }}>
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
                maxWidth: inputRef.current?.clientWidth ?? 720,
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
                      .map(({ value, label, type }, i) => (
                        <div
                          className={`py-2 px-3 d-flex align-items-center ${
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
                          <SuggestionIcon type={type ?? 'field'} />
                          <span>{label}</span>
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
              setIsSearchInputFocused(true);
            }}
            onBlur={() => {
              setSelectedAutocompleteIndex(-1);
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
            rightSectionWidth="auto"
            rightSection={
              <>
                <div className="d-flex align-items-center">
                  {language != null && onLanguageChange != null && (
                    <InputLanguageSwitch
                      showHotkey={showHotkey && isSearchInputFocused}
                      language={language}
                      onLanguageChange={onLanguageChange}
                    />
                  )}
                </div>
              </>
            }
          />
        </OverlayTrigger>
      </div>
      
    </div>
  );
}
