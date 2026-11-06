import { Ref } from 'react';
import { Autocomplete, AutocompleteProps, Loader } from '@mantine/core';

/**
 * While the user is keyboard-navigating suggestions, Enter must pick the
 * highlighted option rather than submit the typed text. Scoped to the input's
 * own listbox so another open combobox on the page can't affect it.
 */
const isSuggestionHighlighted = (input: HTMLInputElement) => {
  const listId = input.getAttribute('aria-controls');
  const list = listId ? document.getElementById(listId) : null;
  return !!list?.querySelector('[data-combobox-selected]');
};

export type FilterAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  /** Enter with no suggestion highlighted, so free text is accepted. */
  onSubmit: (value: string) => void;
  /** A suggestion was picked. Its value is also reported through `onChange`. */
  onOptionSubmit?: (value: string) => void;
  options: string[];
  isLoading?: boolean;
  label?: string;
  placeholder?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  ref?: Ref<HTMLInputElement>;
} & Pick<AutocompleteProps, 'w' | 'size' | 'autoFocus' | 'mb' | 'error'>;

/** Suggestion input for filter keys and values that also accepts free text. */
export function FilterAutocomplete({
  value,
  onChange,
  onSubmit,
  onOptionSubmit,
  options,
  isLoading,
  size = 'xs',
  ...props
}: FilterAutocompleteProps) {
  const testId = props['data-testid'];
  return (
    <Autocomplete
      {...props}
      size={size}
      data={options}
      value={value}
      onChange={onChange}
      onOptionSubmit={onOptionSubmit}
      onKeyDown={e => {
        if (e.key === 'Enter' && !isSuggestionHighlighted(e.currentTarget)) {
          e.preventDefault();
          onSubmit(value);
        }
      }}
      limit={200}
      rightSection={
        isLoading ? (
          <Loader
            size={12}
            data-testid={testId ? `${testId}-loading` : undefined}
          />
        ) : null
      }
      // Keep the dropdown inside the parent popover so picking an option
      // doesn't count as an outside click.
      comboboxProps={{ withinPortal: false }}
    />
  );
}
