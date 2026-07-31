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
  Group,
  NumberInput,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import { shouldFillNullsWithZero } from '@/ChartUtils';
import { DEFAULT_SERIES_LIMIT } from '@/defaults';
import { FormatTime } from '@/useFormatTime';

import { BackgroundChartInput } from './BackgroundChartInput';
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
  | 'backgroundChart'
> & {
  groupByColumnsOnLeft?: boolean;
  alternateRowBackground?: boolean;
  // Per-tile cap on the number of series fetched. On group-by time charts it
  // drives the __hdx_series_limit CTE; on pie/bar builder charts it becomes a
  // plain SQL LIMIT.
  // null/undefined = disabled (every series is fetched). The editor clears to
  // `null` (not `undefined`) so the cleared state survives JSON
  // round-tripping through the URL query state.
  seriesLimit?: number | null;
};

/**
 * Internal form shape: `colorRules` is stored with `localId`s for dnd-kit
 * stability; they are stripped before the settings are passed to `onChange`.
 */
type SectionFormValues = Omit<ChartConfigDisplaySettings, 'colorRules'> & {
  colorRules?: ColorRuleWithId[];
};

interface ChartDisplaySettingsSectionProps {
  settings: ChartConfigDisplaySettings;
  /** Auto-detected number format (e.g. duration for trace sources).
   *  Used as the default when no explicit numberFormat is set. */
  defaultNumberFormat?: NumberFormat;
  displayType: DisplayType;
  /** 'sql' for raw SQL chart configs; anything else is treated as a builder config. */
  configType?: 'sql' | 'builder' | 'promql';
  previousDateRange?: [Date, Date];
  /**
   * Called with the settings whenever the user edits a control. Writes live to
   * the tile draft; the tile's own Save/Cancel is the single commit point, so
   * there is no per-section Apply.
   */
  onChange: (settings: ChartConfigDisplaySettings, isDirty: boolean) => void;
  isPerSeriesNumberFormatAllowed?: boolean;
}

function applyDefaultSettings(
  settings: ChartConfigDisplaySettings,
  fallbackNumberFormat?: NumberFormat,
): SectionFormValues {
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
    alternateRowBackground: settings.alternateRowBackground ?? false,
    // Coerce to null so `reset` clears the input; undefined leaves the
    // previously registered field value in place.
    seriesLimit: settings.seriesLimit ?? null,
    color: settings.color,
    colorRules: settings.colorRules
      ? attachLocalIds(settings.colorRules)
      : undefined,
    backgroundChart: settings.backgroundChart,
  };
}

export default function ChartDisplaySettingsSection({
  settings,
  displayType,
  configType,
  defaultNumberFormat,
  onChange,
  previousDateRange,
  isPerSeriesNumberFormatAllowed = false,
}: ChartDisplaySettingsSectionProps) {
  // The section mounts fresh each time it is opened, so the incoming settings
  // seed the form once. Live edits then flow straight back out via `onChange`.
  const appliedDefaults = useMemo(
    () => applyDefaultSettings(settings, defaultNumberFormat),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount
    [],
  );

  const {
    control,
    setValue,
    reset,
    getValues,
    formState: { dirtyFields },
  } = useForm<SectionFormValues>({
    defaultValues: appliedDefaults,
  });

  const fillNulls = useWatch({ control, name: 'fillNulls' });
  const isFillNullsEnabled = shouldFillNullsWithZero(fillNulls);

  // Push the current form values to the tile draft. `numberFormat` is only
  // persisted when the user actually chose one (either the tile already had an
  // explicit override, or the user touched the format control this session);
  // otherwise emit undefined so the datasource-derived format keeps driving
  // render instead of freezing the inferred fallback into the config.
  const pushChanges = useCallback(() => {
    const formValues = getValues();
    const { colorRules, ...rest } = formValues;
    const numberFormatExplicit =
      settings.numberFormat != null || dirtyFields.numberFormat != null;
    onChange(
      {
        ...rest,
        numberFormat: numberFormatExplicit
          ? formValues.numberFormat
          : undefined,
        colorRules: colorRules ? stripLocalIds(colorRules) : undefined,
      },
      true,
    );
  }, [getValues, onChange, settings.numberFormat, dirtyFields.numberFormat]);

  // Autosave: whenever a field changes (and the user has actually edited
  // something), debounce and write through. Reading the watched snapshot keeps
  // the effect firing on every edit; the debounce coalesces high-frequency
  // inputs (color-rule text, sliders, number inputs) so the preview query is
  // not re-run on every keystroke.
  const watchedValues = useWatch({ control });
  const isDirty = Object.keys(dirtyFields).length > 0;
  useEffect(() => {
    if (!isDirty) return;
    const handle = setTimeout(() => pushChanges(), 300);
    return () => clearTimeout(handle);
  }, [watchedValues, isDirty, pushChanges]);

  const resetToDefaults = useCallback(() => {
    const defaults = applyDefaultSettings(
      {} as ChartConfigDisplaySettings,
      defaultNumberFormat,
    );
    reset(defaults, { keepDefaultValues: true });
    // reset() does not mark fields dirty, so push explicitly.
    onChange(
      {
        ...defaults,
        colorRules: defaults.colorRules
          ? stripLocalIds(defaults.colorRules)
          : undefined,
      },
      true,
    );
  }, [reset, defaultNumberFormat, onChange]);

  const isTimeChart =
    displayType === DisplayType.Line || displayType === DisplayType.StackedBar;

  // The series-limit CTE is only emitted for builder group-by time charts;
  // raw SQL configs author their own LIMIT logic directly.
  const showSeriesLimit =
    isTimeChart && configType !== 'sql' && configType !== 'promql';

  // On pie/bar builder charts, seriesLimit becomes a plain SQL LIMIT on the
  // number of slices/bars; raw SQL configs author their own LIMIT directly.
  const isCategoricalChart =
    displayType === DisplayType.Pie || displayType === DisplayType.Bar;
  const showCategoricalLimit =
    isCategoricalChart && configType !== 'sql' && configType !== 'promql';

  // Table display options. Alternate Row Background is purely presentational
  // (it stripes rendered rows), so it applies to any table tile. Group By
  // column ordering needs the builder `select` structure to know which columns
  // are group-by keys, so it stays builder-only.
  const showTableOptions = displayType === DisplayType.Table;
  const showGroupByColumnsOnLeft = showTableOptions && configType !== 'sql';

  // Tile-level color is only meaningful for number tiles today.
  const showTileColor = displayType === DisplayType.Number;

  // The background sparkline is derived from a time-bucketed version of the
  // tile's query, so it only applies to builder number tiles.
  const showBackgroundChart = displayType === DisplayType.Number;
  const isBackgroundChartDisabled = configType === 'sql';

  return (
    <Stack data-testid="display-settings-section">
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
                setValue('fillNulls', e.currentTarget.checked ? 0 : false, {
                  shouldDirty: true,
                });
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
                render={({ field: { onChange: onFieldChange, value } }) => (
                  <NumberInput
                    size="xs"
                    label="Series Limit"
                    description="Maximum number of series fetched for a group-by chart. Leave empty to fetch every series."
                    placeholder={`Disabled (e.g. ${DEFAULT_SERIES_LIMIT})`}
                    min={1}
                    allowDecimal={false}
                    value={value ?? ''}
                    onChange={v =>
                      onFieldChange(v === '' || v == null ? null : Number(v))
                    }
                  />
                )}
              />
            </Box>
          )}
          <Divider />
        </>
      )}

      {showCategoricalLimit && (
        <>
          <Box>
            <Controller
              control={control}
              name="seriesLimit"
              render={({ field: { onChange: onFieldChange, value } }) => (
                <NumberInput
                  size="xs"
                  label="Series Limit"
                  description="Maximum number of values displayed, keeping those with the largest values. Leave empty to fetch all."
                  placeholder="Disabled (e.g. 10)"
                  min={1}
                  allowDecimal={false}
                  value={value ?? ''}
                  onChange={v =>
                    onFieldChange(v === '' || v == null ? null : Number(v))
                  }
                />
              )}
            />
          </Box>
          <Divider />
        </>
      )}

      {showTableOptions && (
        <>
          {showGroupByColumnsOnLeft && (
            <CheckBoxControlled
              control={control}
              name="groupByColumnsOnLeft"
              size="xs"
              label="Display Group By Columns on Left"
            />
          )}
          <CheckBoxControlled
            control={control}
            name="alternateRowBackground"
            size="xs"
            label="Alternate Row Background"
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
              render={({ field: { onChange: onFieldChange, value } }) => (
                <ColorSwatchInput
                  value={value}
                  onChange={onFieldChange}
                  ariaLabel="Number tile color"
                />
              )}
            />
          </Box>
          <Box>
            <Controller
              control={control}
              name="colorRules"
              render={({ field: { onChange: onFieldChange, value } }) => (
                <ColorRulesEditor
                  value={value ?? []}
                  onChange={onFieldChange}
                />
              )}
            />
          </Box>
          <Divider />
        </>
      )}

      {showBackgroundChart && (
        <>
          <Controller
            control={control}
            name="backgroundChart"
            render={({ field: { onChange: onFieldChange, value } }) => (
              <BackgroundChartInput
                value={value}
                onChange={onFieldChange}
                disabled={isBackgroundChartDisabled}
              />
            )}
          />
          <Divider />
        </>
      )}

      <NumberFormatForm
        control={control}
        setValue={setValue}
        disclaimer={
          isPerSeriesNumberFormatAllowed ? (
            <Alert
              variant="warning"
              p="xs"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="xs" m={0}>
                Format may be overridden on individual series.
              </Text>
            </Alert>
          ) : undefined
        }
      />
      <Divider />
      <Group gap="xs" mt="xs" justify="flex-start">
        <Button variant="secondary" onClick={resetToDefaults}>
          Reset to Defaults
        </Button>
      </Group>
    </Stack>
  );
}
