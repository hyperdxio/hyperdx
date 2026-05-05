import { Control } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { Box, Flex, Select, Tooltip } from '@mantine/core';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { TimePicker } from '@/components/TimePicker';
import { LIVE_TAIL_DURATION_MS } from '@/components/TimePicker/utils';
import { QUERY_LOCAL_STORAGE } from '@/utils';

import { SearchSubmitButton } from './SearchSubmitButton';
import {
  LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS,
  SearchConfigFromSchema,
} from './utils';

type SearchQueryRowProps = {
  control: Control<SearchConfigFromSchema>;
  inputSourceTableConnection: TableConnection | undefined;
  displayedTimeInputValue: string;
  setDisplayedTimeInputValue: (value: string) => void;
  isLive: boolean;
  interval: number;
  refreshFrequency: number;
  setRefreshFrequency: (value: number | null) => void;
  showLive: boolean;
  isFormStateDirty: boolean;
  onSubmit: () => void;
  onTimePickerSearch: (range: string) => void;
  onTimePickerRelativeSearch: (rangeMs: number) => void;
};

export function SearchQueryRow({
  control,
  inputSourceTableConnection,
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  isLive,
  interval,
  refreshFrequency,
  setRefreshFrequency,
  showLive,
  isFormStateDirty,
  onSubmit,
  onTimePickerSearch,
  onTimePickerRelativeSearch,
}: SearchQueryRowProps) {
  return (
    <Flex gap="sm" mt="sm" px="sm" wrap="wrap">
      <SearchWhereInput
        tableConnection={inputSourceTableConnection}
        control={control}
        name="where"
        onSubmit={onSubmit}
        sqlQueryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_SQL}
        luceneQueryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_LUCENE}
        enableHotkey
        data-testid="search-input"
        minWidth="min(600px, 100%)"
      />
      <Flex gap="sm" style={{ flex: '0 1 500px', minWidth: 0 }} align="center">
        <TimePicker
          data-testid="time-picker"
          inputValue={displayedTimeInputValue}
          setInputValue={setDisplayedTimeInputValue}
          onSearch={onTimePickerSearch}
          onRelativeSearch={onTimePickerRelativeSearch}
          showLive={showLive}
          isLiveMode={isLive}
          // Default to relative time mode if the user has made changes to interval and reloaded.
          defaultRelativeTimeMode={isLive && interval !== LIVE_TAIL_DURATION_MS}
          width="100%"
        />
        {isLive && (
          <Tooltip label="Live tail refresh interval">
            <Box style={{ width: 80, minWidth: 80, flexShrink: 0 }}>
              <Select
                size="sm"
                w="100%"
                data={LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS}
                value={String(refreshFrequency)}
                onChange={value =>
                  setRefreshFrequency(value ? parseInt(value, 10) : null)
                }
                allowDeselect={false}
                comboboxProps={{
                  withinPortal: true,
                  zIndex: 1000,
                }}
              />
            </Box>
          </Tooltip>
        )}
        <SearchSubmitButton isFormStateDirty={isFormStateDirty} />
      </Flex>
    </Flex>
  );
}
