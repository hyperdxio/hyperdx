import { Control, UseFormHandleSubmit } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Menu,
  Switch,
  Tooltip,
} from '@mantine/core';
import {
  IconBell,
  IconDotsVertical,
  IconLayoutGrid,
  IconPlayerPlay,
} from '@tabler/icons-react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import { IS_LOCAL_MODE } from '@/config';
import { GranularityPickerControlled } from '@/GranularityPicker';

import { tabQueriesData } from './utils';

export type DashboardFiltersToggleProps = {
  checked: boolean;
  disabledReason?: string;
  onChange: (checked: boolean) => void;
};

function DashboardFiltersToggle({
  checked,
  disabledReason,
  onChange,
}: DashboardFiltersToggleProps) {
  const isDisabled = disabledReason != null;
  const tooltip = isDisabled
    ? disabledReason
    : 'Apply dashboard-level filter and variable selections to the chart preview';

  return (
    <Tooltip label={tooltip} position="top" multiline maw={320}>
      <Box data-testid="apply-dashboard-filters">
        <Switch
          label="Apply filters"
          size="sm"
          labelPosition="left"
          checked={checked}
          disabled={isDisabled}
          onChange={event => onChange(event.currentTarget.checked)}
          style={isDisabled ? { pointerEvents: 'none' } : undefined}
        />
      </Box>
    </Tooltip>
  );
}

type ChartActionBarProps = {
  control: Control<ChartEditorFormState>;
  handleSubmit: UseFormHandleSubmit<ChartEditorFormState>;
  tableConnection: TableConnection;
  sourceId?: string;
  dateRange?: [Date, Date];
  activeTab: string;
  isRawSqlInput: boolean;
  dashboardId?: string;
  parentRef: HTMLElement | null;
  groupBy: ChartEditorFormState['groupBy'];
  onSubmit: (suppressErrorNotification?: boolean) => void;
  handleSave: (form: ChartEditorFormState) => void;
  onSave?: (chart: SavedChartConfig) => void;
  onClose?: () => void;
  isSaving?: boolean;
  /** Whether the edited chart currently carries an alert. */
  hasAlert?: boolean;
  handleSaveAlert?: (form: ChartEditorFormState) => void;
  onSaveAlert?: (chart: SavedChartConfig) => void;
  saveAlertLabel?: string;
  isSavingAlert?: boolean;
  /**
   * Whether to offer "Save to dashboard". Defaults to "outside a dashboard".
   * The inline-alert editor turns it off: saving that chart as a tile would
   * copy its alert onto the tile, leaving two alerts on one query.
   */
  showSaveToDashboard?: boolean;
  displayedTimeInputValue?: string;
  setDisplayedTimeInputValue?: (value: string) => void;
  onTimeRangeSearch?: (value: string) => void;
  filtersToggle?: DashboardFiltersToggleProps;
  setSaveToDashboardModalOpen: (open: boolean) => void;
};

export function ChartActionBar({
  control,
  handleSubmit,
  tableConnection,
  sourceId,
  dateRange,
  activeTab,
  isRawSqlInput,
  dashboardId,
  parentRef,
  groupBy,
  onSubmit,
  handleSave,
  onSave,
  onClose,
  isSaving,
  hasAlert,
  handleSaveAlert,
  onSaveAlert,
  saveAlertLabel = 'Save alert',
  isSavingAlert,
  showSaveToDashboard,
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  onTimeRangeSearch,
  filtersToggle,
  setSaveToDashboardModalOpen,
}: ChartActionBarProps) {
  return (
    <Flex justify="space-between" mt="sm">
      <Flex gap="sm">
        {onSave != null && (
          <Button
            data-testid="chart-save-button"
            loading={isSaving}
            variant="primary"
            onClick={handleSubmit(handleSave)}
          >
            Save
          </Button>
        )}
        {/* Only once an alert exists on the chart: with none there is nothing
            to save, and the button would read as a second way to add one. */}
        {onSaveAlert != null && handleSaveAlert != null && hasAlert && (
          <Button
            data-testid="chart-save-alert-button"
            loading={isSavingAlert}
            variant="primary"
            leftSection={<IconBell size={16} />}
            onClick={handleSubmit(handleSaveAlert)}
          >
            {saveAlertLabel}
          </Button>
        )}
        {onClose != null && (
          <Button
            variant="subtle"
            color="dark"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
        )}
      </Flex>
      <Flex gap="sm" mb="sm" align="center" justify="end">
        {filtersToggle != null && tabQueriesData(activeTab) && (
          <DashboardFiltersToggle {...filtersToggle} />
        )}
        {(activeTab === 'table' ||
          activeTab === 'pie' ||
          activeTab === 'bar') &&
          !isRawSqlInput && (
            <div style={{ width: 400 }} data-testid="order-by-input">
              <SQLInlineEditorControlled
                parentRef={parentRef}
                tableConnection={tableConnection}
                sourceId={sourceId}
                dateRange={dateRange}
                // The default order by is the current group by value
                placeholder={typeof groupBy === 'string' ? groupBy : ''}
                control={control}
                name={`orderBy`}
                disableKeywordAutocomplete
                onSubmit={onSubmit}
                label="ORDER BY"
                enableVariables
              />
            </div>
          )}
        {tabQueriesData(activeTab) &&
          setDisplayedTimeInputValue != null &&
          displayedTimeInputValue != null &&
          onTimeRangeSearch != null && (
            <TimePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={range => {
                onTimeRangeSearch(range);
              }}
              onSubmit={range => {
                onTimeRangeSearch(range);
              }}
            />
          )}
        {activeTab === 'time' && (
          <GranularityPickerControlled control={control} name="granularity" />
        )}
        {tabQueriesData(activeTab) && (
          <Button
            data-testid="chart-run-query-button"
            variant="primary"
            type="submit"
            onClick={() => onSubmit()}
            leftSection={<IconPlayerPlay size={16} />}
            style={{ flexShrink: 0 }}
          >
            Run
          </Button>
        )}
        {!IS_LOCAL_MODE && (showSaveToDashboard ?? !dashboardId) && (
          <Menu width={250}>
            <Menu.Target>
              <ActionIcon variant="secondary" size="input-sm">
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconLayoutGrid size={16} />}
                onClick={() => setSaveToDashboardModalOpen(true)}
              >
                Save to Dashboard
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Flex>
    </Flex>
  );
}
