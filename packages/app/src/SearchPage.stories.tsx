import React from 'react';
import { Stack } from '@mantine/core';

import { FilterCheckbox } from './SearchPage.components';

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

export default meta;
