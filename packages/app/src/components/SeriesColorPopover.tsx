import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type {
  ChartPaletteToken,
  ColorCondition,
} from '@hyperdx/common-utils/dist/types';
import { isChartPaletteToken } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Popover,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconPalette } from '@tabler/icons-react';

import { getColorFromCSSToken } from '@/utils';

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

interface SeriesColorPopoverProps {
  color?: ChartPaletteToken;
  colorRules?: ColorCondition[];
  onChange: (next: {
    color?: ChartPaletteToken;
    colorRules?: ColorCondition[];
  }) => void;
}

/**
 * Per-column color editor for builder table tiles, opened from a swatch on the
 * series row. Renders as a popover anchored to its trigger (the table-cell
 * counterpart of the number-tile color in the display settings section) and
 * writes live to the tile draft, so there is no Apply button.
 */
export default function SeriesColorPopover({
  color,
  colorRules,
  onChange,
}: SeriesColorPopoverProps) {
  const [opened, setOpened] = useState(false);

  // Seed once when the popover mounts; live edits flow back out via onChange.
  const appliedDefaults = useMemo<ColorFormState>(
    () => ({
      color,
      colorRules: colorRules ? attachLocalIds(colorRules) : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount
    [],
  );

  const { control, setValue, getValues, formState } = useForm<ColorFormState>({
    defaultValues: appliedDefaults,
  });

  const currentColor = useWatch({ control, name: 'color' });
  const currentRules = useWatch({ control, name: 'colorRules' });
  const hasSelection = currentColor != null || (currentRules?.length ?? 0) > 0;

  const isDirty = Object.keys(formState.dirtyFields).length > 0;
  useEffect(() => {
    if (!isDirty) return;
    const handle = setTimeout(() => {
      const values = getValues();
      onChange({
        color: values.color,
        colorRules:
          values.colorRules && values.colorRules.length > 0
            ? stripLocalIds(values.colorRules)
            : undefined,
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [currentColor, currentRules, isDirty, getValues, onChange]);

  const clearColor = () => {
    setValue('color', undefined, { shouldDirty: true });
    setValue('colorRules', undefined, { shouldDirty: true });
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      withinPortal
      closeOnEscape
      closeOnClickOutside
      trapFocus
    >
      <Popover.Target>
        <Tooltip label="Edit column color">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            onClick={() => setOpened(o => !o)}
            aria-label="Edit column color"
            aria-haspopup="dialog"
            aria-expanded={opened}
            data-testid="series-color-button"
          >
            <IconPalette
              size={16}
              color={
                color && isChartPaletteToken(color)
                  ? getColorFromCSSToken(color)
                  : undefined
              }
            />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm" style={{ width: 320 }}>
        <Stack data-testid="series-color-popover">
          <Stack gap="xs">
            <div>
              <Text size="xs" fw={500} mb={2}>
                Color
              </Text>
              <Text size="xs" c="dimmed">
                Applies to every cell in this column unless a rule below
                matches.
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
          {hasSelection && (
            <Button
              variant="secondary"
              onClick={clearColor}
              data-testid="series-color-clear"
            >
              Clear
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
