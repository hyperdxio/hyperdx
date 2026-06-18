import { useCallback, useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ChartConfigWithDateRange,
  DisplayType,
  NumberFormat,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  NumberInput,
  Stack,
  Text,
} from '@mantine/core';

import { shouldFillNullsWithZero } from '@/ChartUtils';
import { DEFAULT_SERIES_LIMIT } from '@/defaults';
import { FormatTime } from '@/useFormatTime';

import {
  attachLocalIds,
  ColorRulesEditor,
  ColorRuleWithId,
  stripLocalIds,
} from './ColorRulesEditor';
import { ColorSwatchInput } from './ColorSwatchInput';
import { CheckBoxControlled } from './InputControlled';
import { DEFAULT_NUMBER_FORMAT, NumberFormatForm } from './NumberFormat';

export type ChartConfigDisplaySettings = Pick<
  ChartConfigWithDateRange,
  | 'numberFormat'
  | 'alignDateRangeToGranularity'
  | 'fillNulls'
  | 'compareToPreviousPeriod'
  | 'fitYAxisToData'
  | 'color'
  | 'colorRules'
> & {
  groupByColumnsOnLeft?: boolean;
  // Per-tile cap on the number of series fetched for a group-by time chart.
  // null/undefined = disabled (no __hdx_series_limit CTE; every series is
  // fetched). The editor clears to `null` (not `undefined`) so the cleared
  // state survives JSON round-tripping through the URL query state.
  seriesLimit?: number | null;
};

/**
 * Internal form shape: `colorRules` is stored with `localId`s for dnd-kit
 * stability; they are stripped before the settings are passed to `onChange`.
 */
type DrawerFormValues = Omit<ChartConfigDisplaySettings, 'colorRules'> & {
  colorRules?: ColorRuleWithId[];
};

interface ChartDisplaySettingsDrawerProps {
  opened: boolean;
  settings: ChartConfigDisplaySettings;
  /** Auto-detected number format (e.g. duration for trace sources).
   *  Used as the default when no explicit numberFormat is set. */
  defaultNumberFormat?: NumberFormat;
  displayType: DisplayType;
  /** 'sql' for raw SQL chart configs; anything else is treated as a builder config. */
  configType?: 'sql' | 'builder' | 'promql';
  previousDateRange?: [Date, Date];
  onChange: (settings: ChartConfigDisplaySettings) => void;
  onClose: () => void;
  isPerSeriesNumberFormatAllowed?: boolean;
}

function applyDefaultSettings(
  settings: ChartConfigDisplaySettings,
  fallbackNumberFormat?: NumberFormat,
): DrawerFormValues {
  return {
    numberFormat:
      settings.numberFormat ?? fallbackNumberFormat ?? DEFAULT_NUMBER_FORMAT,
    alignDateRangeToGranularity:
      settings.alignDateRangeToGranularity == null
        ? true
        : settings.alignDateRangeToGranularity,
    fillNulls: settings.fillNulls ?? 0,
    compareToPreviousPeriod: settings.compareToPreviousPeriod ?? false,
    fitYAxisToData: settings.fitYAxisToData ?? false,
    groupByColumnsOnLeft: settings.groupByColumnsOnLeft ?? false,
    // Coerce to null so `reset` clears the input; undefined leaves the
    // previously registered field value in place.
    seriesLimit: settings.seriesLimit ?? null,
    color: settings.color,
    colorRules: settings.colorRules
      ? attachLocalIds(settings.colorRules)
      : undefined,
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
  isPerSeriesNumberFormatAllowed = false,
}: ChartDisplaySettingsDrawerProps) {
  const appliedDefaults = useMemo(
    () => applyDefaultSettings(settings, defaultNumberFormat),
    [settings, defaultNumberFormat],
  );

  const { control, handleSubmit, reset, setValue } = useForm<DrawerFormValues>({
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
    handleSubmit(formValues => {
      // Strip client-side localIds before passing rules to the config.
      const { colorRules, ...rest } = formValues;
      onChange({
        ...rest,
        colorRules: colorRules ? stripLocalIds(colorRules) : undefined,
      });
    })();
    onClose();
  }, [onChange, handleSubmit, onClose]);

  const resetToDefaults = useCallback(() => {
    reset(
      applyDefaultSettings(
        {} as ChartConfigDisplaySettings,
        defaultNumberFormat,
      ),
    );
  }, [reset, defaultNumberFormat]);

  const isTimeChart =
    displayType === DisplayType.Line || displayType === DisplayType.StackedBar;

  // The series-limit CTE is only emitted for builder group-by time charts;
  // raw SQL configs author their own LIMIT logic directly.
  const showSeriesLimit = isTimeChart && configType !== 'sql';

  // Group By column ordering only applies to builder table charts; raw SQL
  // configs let the user author whatever column order they want directly.
  const showGroupByColumnsOnLeft =
    displayType === DisplayType.Table && configType !== 'sql';

  // Tile-level color is only meaningful for number tiles today.
  // Per-series colors on line / bar / pie ship in a follow-up PR via
  // `select[i].color`.
  const showTileColor = displayType === DisplayType.Number;

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
            <CheckBoxControlled
              control={control}
              name="fitYAxisToData"
              size="xs"
              label="Fit Y-Axis to Data"
              description="Start the y-axis at the minimum of the displayed data instead of zero. Only applicable to line charts."
            />
            {showSeriesLimit && (
              <Box>
                <Controller
                  control={control}
                  name="seriesLimit"
                  render={({ field: { onChange, value } }) => (
                    <NumberInput
                      size="xs"
                      label="Series Limit"
                      description="Maximum number of series fetched for a group-by chart. Leave empty to fetch every series."
                      placeholder={`Disabled (e.g. ${DEFAULT_SERIES_LIMIT})`}
                      min={1}
                      allowDecimal={false}
                      value={value ?? ''}
                      onChange={v =>
                        onChange(v === '' || v == null ? null : Number(v))
                      }
                    />
                  )}
                />
              </Box>
            )}
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

        {showTileColor && (
          <>
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                Color
              </Text>
              <Controller
                control={control}
                name="color"
                render={({ field: { onChange, value } }) => (
                  <ColorSwatchInput
                    value={value}
                    onChange={onChange}
                    ariaLabel="Number tile color"
                  />
                )}
              />
            </Box>
            <Box>
              <Controller
                control={control}
                name="colorRules"
                render={({ field: { onChange, value } }) => (
                  <ColorRulesEditor value={value ?? []} onChange={onChange} />
                )}
              />
            </Box>
            <Divider />
          </>
        )}

        <NumberFormatForm
          control={control}
          setValue={setValue}
          disclaimer={
            isPerSeriesNumberFormatAllowed ? (
              <Alert variant="outline" color="yellow" p="xs">
                <Text size="xs" m={0}>
                  Format may be overridden on individual series.
                </Text>
              </Alert>
            ) : undefined
          }
        />
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
