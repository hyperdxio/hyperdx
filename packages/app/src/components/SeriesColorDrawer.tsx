import { useCallback, useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type {
  ChartPaletteToken,
  ColorCondition,
} from '@hyperdx/common-utils/dist/types';
import { Button, Drawer, Group, Stack, Text } from '@mantine/core';

import {
  attachLocalIds,
  ColorRulesEditor,
  ColorRuleWithId,
  stripLocalIds,
} from './ColorRulesEditor';
import { ColorSwatchInput } from './ColorSwatchInput';

type ColorFormState = {
  color?: ChartPaletteToken;
  colorRules?: ColorRuleWithId[];
};

interface SeriesColorDrawerProps {
  opened: boolean;
  color?: ChartPaletteToken;
  colorRules?: ColorCondition[];
  onChange: (next: {
    color?: ChartPaletteToken;
    colorRules?: ColorCondition[];
  }) => void;
  onClose: () => void;
}

/**
 * Per-column color editor for builder table tiles, opened from the series
 * row. A static palette-token color plus ordered conditional rules, the
 * table-cell counterpart of the number-tile color in
 * `ChartDisplaySettingsDrawer`. Reuses `ColorSwatchInput` and
 * `ColorRulesEditor`; resolution happens per cell in `HDXMultiSeriesTableChart`
 * via the shared `resolveConditionalColor`.
 */
export default function SeriesColorDrawer({
  opened,
  color,
  colorRules,
  onChange,
  onClose,
}: SeriesColorDrawerProps) {
  // Attach client-side localIds once per incoming value so the dnd-kit rows
  // keep stable keys for the editing session; strip them on apply. Mirrors
  // ChartDisplaySettingsDrawer's handling of number-tile color rules.
  const appliedDefaults = useMemo<ColorFormState>(
    () => ({
      color,
      colorRules: colorRules ? attachLocalIds(colorRules) : undefined,
    }),
    [color, colorRules],
  );

  const { control, handleSubmit, reset, setValue } = useForm<ColorFormState>({
    defaultValues: appliedDefaults,
  });

  useEffect(() => {
    reset(appliedDefaults);
  }, [appliedDefaults, reset]);

  const currentColor = useWatch({ control, name: 'color' });
  const currentRules = useWatch({ control, name: 'colorRules' });
  const hasSelection = currentColor != null || (currentRules?.length ?? 0) > 0;

  const handleClose = useCallback(() => {
    reset(appliedDefaults);
    onClose();
  }, [reset, appliedDefaults, onClose]);

  const applyChanges = useCallback(() => {
    handleSubmit(values => {
      onChange({
        color: values.color,
        colorRules:
          values.colorRules && values.colorRules.length > 0
            ? stripLocalIds(values.colorRules)
            : undefined,
      });
    })();
    onClose();
  }, [handleSubmit, onChange, onClose]);

  const clearColor = useCallback(() => {
    setValue('color', undefined);
    setValue('colorRules', undefined);
  }, [setValue]);

  return (
    <Drawer
      title="Column Color"
      opened={opened}
      onClose={handleClose}
      position="right"
    >
      <Stack>
        <Stack gap="xs">
          <div>
            <Text size="xs" fw={500} mb={2}>
              Color
            </Text>
            <Text size="xs" c="dimmed">
              Applies to every cell in this column unless a rule below matches.
            </Text>
          </div>
          <Controller
            control={control}
            name="color"
            render={({ field }) => (
              <ColorSwatchInput
                value={field.value}
                onChange={field.onChange}
                ariaLabel="Column color"
              />
            )}
          />
        </Stack>
        <Controller
          control={control}
          name="colorRules"
          render={({ field }) => (
            <ColorRulesEditor
              value={field.value ?? []}
              onChange={field.onChange}
            />
          )}
        />
        <Group gap="xs" mt="xs" justify="space-between">
          {hasSelection ? (
            <Button
              variant="secondary"
              onClick={clearColor}
              data-testid="series-color-clear"
            >
              Clear
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            onClick={applyChanges}
            data-testid="series-color-apply"
          >
            Apply
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
