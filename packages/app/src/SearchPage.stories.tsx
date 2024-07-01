import React from 'react';
import { Stack } from '@mantine/core';

import { FilterCheckbox, FilterGroup } from './SearchPage.components';

const meta = {
  title: 'SearchPage/Filters',
  parameters: {},
};

export const Default = () => {
  const [filterState, setFilterState] = React.useState<any>({});

  return (
    <>
      <Stack w={160} gap={0}>
        <FilterCheckbox
          label="Logs"
          value={filterState.logs}
          onChange={(checked: boolean) =>
            setFilterState({ ...filterState, logs: checked })
          }
          onClickOnly={() => setFilterState({ logs: true })}
        />
        <FilterCheckbox
          label="Spans"
          value={filterState.spans}
          onChange={(checked: boolean) =>
            setFilterState({ ...filterState, spans: checked })
          }
          onClickOnly={() => setFilterState({ spans: true })}
        />
      </Stack>
    </>
  );
};

export const Group = () => {
  return (
    <div style={{ width: 200 }}>
      <FilterGroup
        name="Level"
        options={[
          ...Array.from({ length: 20 }).map((_, index) => ({
            value: `level${index}`,
            label: `Level ${index}`,
          })),
          {
            value: 'very-long-super-long-absolutely-ridiculously-long',
            label: 'very-long-super-long-absolutely-ridiculously-long',
          },
        ]}
        selectedValues={new Set(['info'])}
        onChange={() => {}}
        onClearClick={() => {}}
        onOnlyClick={() => {}}
      />
    </div>
  );
};

export const GroupLoading = () => {
  return (
    <div style={{ width: 200 }}>
      <FilterGroup
        name="Level"
        options={[]}
        optionsLoading
        selectedValues={new Set(['info'])}
        onChange={() => {}}
        onClearClick={() => {}}
        onOnlyClick={() => {}}
      />
    </div>
  );
};

export default meta;
