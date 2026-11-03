import { TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

/* Lists with more items than this get a search input */
export const FILTER_SEARCH_MIN_ITEMS = 5;

type FilterSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  'data-testid'?: string;
};

export const FilterSearchInput = ({
  value,
  onChange,
  placeholder,
  'data-testid': dataTestId,
}: FilterSearchInputProps) => (
  <div className="px-2 pb-2">
    <TextInput
      size="xs"
      placeholder={placeholder}
      value={value}
      data-testid={dataTestId}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
        onChange(event.currentTarget.value)
      }
      rightSectionWidth={20}
      rightSection={<IconSearch size={12} stroke={2} />}
      classNames={{
        input: 'ps-0.5',
      }}
    />
  </div>
);
