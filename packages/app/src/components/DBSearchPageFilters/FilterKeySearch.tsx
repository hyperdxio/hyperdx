import { CloseButton, Loader, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

/**
 * Search box for the filter sidebar, matching on filter (column) names rather
 * than their values. Matches already on screen filter instantly; `isFetching`
 * covers the query that goes looking for fields the browse list never loaded.
 */
export function FilterKeySearch({
  value,
  onChange,
  isFetching,
}: {
  value: string;
  onChange: (value: string) => void;
  isFetching: boolean;
}) {
  return (
    <TextInput
      size="xs"
      placeholder="Search filter column/properties"
      aria-label="Search filter column/properties"
      data-testid="filter-key-search"
      value={value}
      onChange={event => onChange(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === 'Escape' && value) {
          // Stop it bubbling to whatever else listens for Escape on the page;
          // clearing the search is the more specific intent here.
          event.stopPropagation();
          onChange('');
        }
      }}
      leftSection={<IconSearch size={12} stroke={2} />}
      leftSectionWidth={24}
      rightSection={
        isFetching ? (
          <Loader size={12} color="gray" />
        ) : value ? (
          <CloseButton
            size="xs"
            aria-label="Clear filter search"
            onClick={() => onChange('')}
          />
        ) : null
      }
    />
  );
}
