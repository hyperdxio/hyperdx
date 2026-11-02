import { Ref } from 'react';
import {
  Autocomplete,
  AutocompleteProps,
  Loader,
  OptionsFilter,
} from '@mantine/core';

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

/**
 * 0 when `label` starts with `query`, 1 when one of its parts does, 2 when it
 * only contains it, and Infinity when it doesn't.
 */
const matchRank = (label: string, query: string) => {
  let rank = Infinity;
  for (
    let i = label.indexOf(query);
    i !== -1;
    i = label.indexOf(query, i + 1)
  ) {
    if (i === 0) return 0;
    // A part starts after a separator, e.g. the map key in `Map['key']`.
    rank = Math.min(rank, /[a-z0-9]/.test(label[i - 1]) ? 2 : 1);
  }
  return rank;
};

/**
 * Case-insensitive matches, best rank first and shorter first within a rank,
 * so "Serv" lists `ServiceName` above every `LogAttributes['agentToServer…']`.
 * Ranked before the limit is applied, so the best match can't be cut off.
 */
const rankedFilter: OptionsFilter = ({ options, search, limit }) => {
  const query = search.trim().toLowerCase();
  if (!query) return options.slice(0, limit);
  return options
    .flatMap(option => {
      if ('group' in option) return [];
      const rank = matchRank(option.label.toLowerCase(), query);
      return rank === Infinity ? [] : [{ option, rank }];
    })
    .sort(
      (a, b) =>
        a.rank - b.rank || a.option.label.length - b.option.label.length,
    )
    .slice(0, limit)
    .map(({ option }) => option);
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
} & Pick<
  AutocompleteProps,
  'w' | 'size' | 'autoFocus' | 'mb' | 'error' | 'onBlur'
>;

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
      filter={rankedFilter}
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
