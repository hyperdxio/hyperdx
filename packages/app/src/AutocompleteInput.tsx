import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Form, InputGroup, OverlayTrigger } from 'react-bootstrap';

import { useDebounce } from './utils';

export default function AutocompleteInput({
  inputRef,
  value,
  onChange,
  placeholder = 'Search your events for anything...',
  autocompleteOptions,
  showHotkey = true,
  size = 'lg',
  aboveSuggestions,
  belowSuggestions,
  showSuggestionsOnEmpty,
  suggestionsHeader = 'Properties',
  zIndex = 999,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showHotkey?: boolean;
  size?: 'sm' | 'lg';
  autocompleteOptions?: { value: string; label: string }[];
  aboveSuggestions?: React.ReactNode;
  belowSuggestions?: React.ReactNode;
  showSuggestionsOnEmpty?: boolean;
  suggestionsHeader?: string;
  zIndex?: number;
}) {
  const suggestionsLimit = 10;
  const inputGroupRef = useRef<HTMLDivElement>(null);

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

  const debouncedValue = useDebounce(value, 200);
  const suggestedProperties = useMemo(() => {
    const tokens = debouncedValue.split(' ');
    const lastToken = tokens[tokens.length - 1];

    if (lastToken.length === 0 && showSuggestionsOnEmpty) {
      return autocompleteOptions ?? [];
    }
    return fuse.search(lastToken).map(result => result.item);
  }, [debouncedValue, fuse, autocompleteOptions, showSuggestionsOnEmpty]);

  const onAcceptSuggestion = (suggestion: string) => {
    setSelectedAutocompleteIndex(-1);

    const newValue =
      value.split(' ').slice(0, -1).join(' ') +
      `${value.split(' ').length > 1 ? ' ' : ''}${suggestion}`;
    onChange(newValue);
    inputRef.current?.focus();
  };

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
            maxWidth: inputGroupRef.current?.clientWidth ?? 720,
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
      <InputGroup ref={inputGroupRef}>
        <Form.Control
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className="border-0 fs-7 mono"
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
        />
        {isSearchInputFocused && showHotkey ? (
          <InputGroup.Text className="ps-0 pe-3">
            <div
              className="mono px-1 fs-8 text-muted"
              style={{
                border: '1px solid #37414d',
                borderRadius: 3,
                padding: '1px 4px',
                background: '#626262',
              }}
            >
              {'/'}
            </div>
          </InputGroup.Text>
        ) : null}
      </InputGroup>
    </OverlayTrigger>
  );
}
