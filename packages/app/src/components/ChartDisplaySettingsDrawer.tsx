import { useCallback } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Stack,
} from '@mantine/core';

import { shouldFillNullsWithZero } from '@/ChartUtils';
import { FormatTime } from '@/useFormatTime';

import { DEFAULT_NUMBER_FORMAT, NumberFormatForm } from './NumberFormat';

export type ChartConfigDisplaySettings = Pick<
  ChartConfigWithDateRange,
  | 'numberFormat'
  | 'alignDateRangeToGranularity'
  | 'fillNulls'
  | 'compareToPreviousPeriod'
>;

interface ChartDisplaySettingsDrawerProps {
  opened: boolean;
  settings: ChartConfigDisplaySettings;
  displayType: DisplayType;
  previousDateRange?: [Date, Date];
  onChange: (settings: ChartConfigDisplaySettings) => void;
  onClose: () => void;
}

function applyDefaultSettings({
  numberFormat,
  alignDateRangeToGranularity,
  compareToPreviousPeriod,
  fillNulls,
}: ChartConfigDisplaySettings): ChartConfigDisplaySettings {
  return {
    numberFormat: numberFormat ?? DEFAULT_NUMBER_FORMAT,
    alignDateRangeToGranularity:
      alignDateRangeToGranularity == null ? true : alignDateRangeToGranularity,
    fillNulls: fillNulls ?? 0,
    compareToPreviousPeriod: compareToPreviousPeriod ?? false,
  };
}

export default function ChartDisplaySettingsDrawer({
  settings,
  opened,
  displayType,
  onChange,
  onClose,
  previousDateRange,
}: ChartDisplaySettingsDrawerProps) {
  const { control, handleSubmit, register, reset, setValue } =
    useForm<ChartConfigDisplaySettings>({
      defaultValues: applyDefaultSettings(settings),
    });

  const fillNulls = useWatch({ control, name: 'fillNulls' });
  const isFillNullsEnabled = shouldFillNullsWithZero(fillNulls);

  const handleClose = useCallback(() => {
    reset(applyDefaultSettings(settings)); // Reset to default values, without saving
    onClose();
  }, [onClose, reset, settings]);

  const applyChanges = useCallback(() => {
    handleSubmit(onChange)();
    onClose();
  }, [onChange, handleSubmit, onClose]);

  const resetToDefaults = useCallback(() => {
    reset(applyDefaultSettings({}));
  }, [reset]);

  const isTimeChart =
    displayType === DisplayType.Line || displayType === DisplayType.StackedBar;

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
            <Checkbox
              size="xs"
              label="Show Complete Intervals"
              {...register('alignDateRangeToGranularity')}
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
            <Checkbox
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
              {...register('compareToPreviousPeriod')}
            />
            <Divider />
          </>
        )}

        <NumberFormatForm control={control} />
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
