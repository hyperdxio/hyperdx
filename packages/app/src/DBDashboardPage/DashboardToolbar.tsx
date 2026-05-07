import { Dispatch, SetStateAction } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { SQLInterval } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Button, Flex, Tooltip } from '@mantine/core';
import {
  IconFilterEdit,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';
import { Control, UseFormSetValue } from 'react-hook-form';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { TimePicker } from '@/components/TimePicker';
import { GranularityPickerControlled } from '@/GranularityPicker';

import { DashboardQueryFormValues } from './types';

type DashboardToolbarProps = {
  tableConnections: TableConnection[];
  control: Control<DashboardQueryFormValues>;
  setValue: UseFormSetValue<DashboardQueryFormValues>;
  displayedTimeInputValue: string;
  setDisplayedTimeInputValue: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onSearch: (range: string) => void;
  isRefreshEnabled: boolean;
  granularityOverride: SQLInterval | undefined;
  isLive: boolean;
  setIsLive: Dispatch<SetStateAction<boolean>>;
  refresh: () => void;
  manualRefreshCooloff: boolean;
  onOpenFilters: () => void;
};

export function DashboardToolbar({
  tableConnections,
  control,
  setValue,
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  onSubmit,
  onSearch,
  isRefreshEnabled,
  granularityOverride,
  isLive,
  setIsLive,
  refresh,
  manualRefreshCooloff,
  onOpenFilters,
}: DashboardToolbarProps) {
  return (
    <Flex
      gap="sm"
      mt="sm"
      wrap="wrap"
      component="form"
      onSubmit={e => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <SearchWhereInput
        tableConnections={tableConnections}
        control={control}
        name="where"
        onSubmit={onSubmit}
        onLanguageChange={(lang: 'sql' | 'lucene') =>
          setValue('whereLanguage', lang)
        }
        label="WHERE"
        enableHotkey
        allowMultiline
        minWidth={300}
        data-testid="search-input"
      />
      <TimePicker
        inputValue={displayedTimeInputValue}
        setInputValue={setDisplayedTimeInputValue}
        onSearch={range => {
          onSearch(range);
        }}
      />
      <GranularityPickerControlled control={control} name="granularity" />
      <Tooltip
        withArrow
        label={
          isRefreshEnabled
            ? `Auto-refreshing with ${granularityOverride} interval`
            : 'Enable auto-refresh'
        }
        fz="xs"
        color="gray"
      >
        <Button
          onClick={() => setIsLive(prev => !prev)}
          size="sm"
          variant={isLive ? 'primary' : 'secondary'}
          title={isLive ? 'Disable auto-refresh' : 'Enable auto-refresh'}
        >
          Live
        </Button>
      </Tooltip>
      <Tooltip withArrow label="Refresh dashboard" fz="xs" color="gray">
        <ActionIcon
          onClick={refresh}
          loading={manualRefreshCooloff}
          disabled={manualRefreshCooloff}
          variant="secondary"
          title="Refresh dashboard"
          size="input-sm"
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip withArrow label="Edit Filters" fz="xs" color="gray">
        <ActionIcon
          variant="secondary"
          onClick={onOpenFilters}
          data-testid="edit-filters-button"
          size="input-sm"
        >
          <IconFilterEdit size={18} />
        </ActionIcon>
      </Tooltip>
      <Button
        data-testid="search-submit-button"
        variant="primary"
        type="submit"
        leftSection={<IconPlayerPlay size={16} />}
        style={{ flexShrink: 0 }}
      >
        Run
      </Button>
    </Flex>
  );
}
