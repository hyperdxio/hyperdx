import { useCallback, useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ChartConfigWithDateRange,
  DisplayType,
  NumberFormat,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  NumberInput,
  Stack,
} from '@mantine/core';

import { shouldFillNullsWithZero } from '@/ChartUtils';
import { FormatTime } from '@/useFormatTime';

import { CheckBoxControlled } from './InputControlled';
import { DEFAULT_NUMBER_FORMAT, NumberFormatForm } from './NumberFormat';

export const DEFAULT_MAX_GROUPS = 10;

export type ChartConfigDisplaySettings = Pick<
  ChartConfigWithDateRange,
  | 'numberFormat'
  | 'alignDateRangeToGranularity'
  | 'fillNulls'
  | 'compareToPreviousPeriod'
> & {
  limit?: { limit?: number };
  groupByColumnsOnLeft?: boolean;
};

interface ChartDisplaySettingsDrawerProps {
  opened: boolean;
  settings: ChartConfigDisplaySettings;
  /** Auto-detected number format (e.g. duration for trace sources).
   *  Used as the default when no explicit numberFormat is set. */
  defaultNumberFormat?: NumberFormat;
  displayType: DisplayType;
  /** 'sql' for raw SQL chart configs; anything else is treated as a builder config. */
  configType?: 'sql' | 'builder';
  previousDateRange?: [Date, Date];
  onChange: (settings: ChartConfigDisplaySettings) => void;
  onClose: () => void;
}

function applyDefaultSettings(
  settings: ChartConfigDisplaySettings,
  fallbackNumberFormat?: NumberFormat,
): ChartConfigDisplaySettings {
  return {
    numberFormat:
      settings.numberFormat ?? fallbackNumberFormat ?? DEFAULT_NUMBER_FORMAT,
    alignDateRangeToGranularity:
      settings.alignDateRangeToGranularity == null
        ? true
        : settings.alignDateRangeToGranularity,
    fillNulls: settings.fillNulls ?? 0,
    compareToPreviousPeriod: settings.compareToPreviousPeriod ?? false,
    limit: settings.limit ?? { limit: DEFAULT_MAX_GROUPS },
    groupByColumnsOnLeft: settings.groupByColumnsOnLeft ?? false,
  };
}

export default function ChartDisplaySettingsDrawer({
  settings,
  opened,
  displayType,
  configType,
  defaultNumberFormat,
  onChange,
  onClose,
  previousDateRange,
}: ChartDisplaySettingsDrawerProps) {
  const appliedDefaults = useMemo(
    () => applyDefaultSettings(settings, defaultNumberFormat),
    [settings, defaultNumberFormat],
  );

  const { control, handleSubmit, reset, setValue } =
    useForm<ChartConfigDisplaySettings>({
      defaultValues: appliedDefaults,
    });

  useEffect(() => {
    reset(appliedDefaults);
  }, [appliedDefaults, reset]);

  const fillNulls = useWatch({ control, name: 'fillNulls' });
  const isFillNullsEnabled = shouldFillNullsWithZero(fillNulls);

  const handleClose = useCallback(() => {
    reset(appliedDefaults);
    onClose();
  }, [onClose, reset, appliedDefaults]);

  const applyChanges = useCallback(() => {
    handleSubmit(onChange)();
    onClose();
  }, [onChange, handleSubmit, onClose]);

  const resetToDefaults = useCallback(() => {
    reset(applyDefaultSettings({}, defaultNumberFormat));
  }, [reset, defaultNumberFormat]);

  const isTimeChart =
    displayType === DisplayType.Line || displayType === DisplayType.StackedBar;
  const isBarChart = displayType === DisplayType.Bar && configType !== 'sql';

  // Group By column ordering only applies to builder table charts; raw SQL
  // configs let the user author whatever column order they want directly.
  const showGroupByColumnsOnLeft =
    displayType === DisplayType.Table && configType !== 'sql';

  return (
    <Drawer
      title="Display Settings"
      opened={opened}
      onClose={handleClose}
      position="right"
    >
      <Stack>
        {isTimeChart && (
          <>
            <CheckBoxControlled
              control={control}
              name="alignDateRangeToGranularity"
              size="xs"
              label="Show Complete Intervals"
            />
            <Box>
              <Checkbox
                size="xs"
                label="Fill Missing Intervals with Zero"
                checked={isFillNullsEnabled}
                onChange={e => {
                  setValue('fillNulls', e.currentTarget.checked ? 0 : false);
                }}
              />
            </Box>
            <CheckBoxControlled
              control={control}
              name="compareToPreviousPeriod"
              size="xs"
              label="Compare to Previous Period"
              description={
                previousDateRange && (
                  <>
                    (
                    <FormatTime value={previousDateRange[0]} format="short" />
                    {' - '}
                    <FormatTime value={previousDateRange[1]} format="short" />)
                  </>
                )
              }
            />
            <Divider />
          </>
        )}

        {isBarChart && (
          <>
            <Box>
              <Controller
                control={control}
                name="limit"
                render={({ field }) => (
                  <NumberInput
                    size="xs"
                    label="Max Number of Groups"
                    min={1}
                    max={1000}
                    value={field.value?.limit ?? DEFAULT_MAX_GROUPS}
                    onChange={v =>
                      field.onChange({
                        limit: typeof v === 'number' ? v : DEFAULT_MAX_GROUPS,
                      })
                    }
                  />
                )}
              />
            </Box>
            <Divider />
          </>
        )}

        {showGroupByColumnsOnLeft && (
          <>
            <CheckBoxControlled
              control={control}
              name="groupByColumnsOnLeft"
              size="xs"
              label="Display Group By Columns on Left"
            />
            <Divider />
          </>
        )}

        <NumberFormatForm control={control} setValue={setValue} />
        <Divider />
        <Group gap="xs" mt="xs" justify="space-between">
          <Button type="submit" variant="secondary" onClick={resetToDefaults}>
            Reset to Defaults
          </Button>
          <Button type="submit" variant="primary" onClick={applyChanges}>
            Apply
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
