import { useCallback } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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
  NumberInput,
  Stack,
} from '@mantine/core';

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
  const isFillNullsEnabled = fillNulls !== false;

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
                label="Fill missing intervals"
                checked={isFillNullsEnabled}
                onChange={e => {
                  setValue('fillNulls', e.currentTarget.checked ? 0 : false);
                }}
              />
              <Controller
                control={control}
                name="fillNulls"
                render={({ field: { value, onChange } }) => (
                  <Box ms={28} mt={6} maw={250}>
                    <NumberInput
                      size="xs"
                      disabled={!isFillNullsEnabled}
                      description="Value to use for missing intervals"
                      value={typeof value === 'number' ? value : 0}
                      onChange={value =>
                        onChange(
                          typeof value === 'number'
                            ? value
                            : Number.parseFloat(value || '0'),
                        )
                      }
                      step={1}
                    />
                  </Box>
                )}
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
