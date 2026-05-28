import React from 'react';
import {
  ActionIcon,
  Button,
  ColorSwatch,
  Group,
  Popover,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { IconCircleOff, IconX } from '@tabler/icons-react';

import {
  CATEGORICAL_PALETTE_TOKENS,
  ChartPaletteToken,
  getColorFromCSSToken,
  resolveChartPaletteToken,
  SEMANTIC_PALETTE_TOKENS,
} from '@/utils';

import classes from './ColorSwatchInput.module.scss';

const Z_INDEX = 9999;

const TOKEN_LABELS: Record<ChartPaletteToken, string> = {
  'chart-blue': 'Blue',
  'chart-orange': 'Orange',
  'chart-red': 'Red',
  'chart-cyan': 'Cyan',
  'chart-green': 'Green',
  'chart-pink': 'Pink',
  'chart-purple': 'Purple',
  'chart-light-blue': 'Light Blue',
  'chart-brown': 'Brown',
  'chart-gray': 'Gray',
  'chart-success': 'Success',
  'chart-warning': 'Warning',
  'chart-error': 'Error',
};

type ColorSwatchInputProps = {
  /** Currently selected palette token, if any. */
  value?: ChartPaletteToken;
  /** Called with the new token, or `undefined` when the user clears the picker. */
  onChange?: (value?: ChartPaletteToken) => void;
  /** Optional label shown in the trigger when no color is selected. */
  label?: string;
  /** Disable the trigger and prevent opening the popover. */
  disabled?: boolean;
  /** Accessible label used when no `label` prop is provided. */
  ariaLabel?: string;
};

/**
 * Palette picker for chart series, number-tile, threshold, and
 * reference-line colors. Always persists a `ChartPaletteToken`, never
 * a raw hex value, so user choices reflow correctly across themes and
 * light / dark color modes.
 *
 * See `notes/repo-conventions/hyperdx/tile-styling.md` for the full
 * design decision (palette-only, no free-form hex).
 */
export const ColorSwatchInput = ({
  value,
  onChange,
  label = 'Color',
  disabled = false,
  ariaLabel,
}: ColorSwatchInputProps) => {
  const [opened, setOpened] = React.useState(false);

  // Accept both current hue-named tokens and legacy `chart-1`..`chart-10`
  // values from #2265. The fetch normalizer in `dashboard.ts` usually
  // heals stored data before it reaches us, but in-memory tiles or
  // preset configs can still arrive with legacy values. Truly unknown
  // values fall through to "no selection".
  const safeValue = resolveChartPaletteToken(value);

  const handleChange = (next?: ChartPaletteToken) => {
    onChange?.(next);
    setOpened(false);
  };

  const triggerAriaLabel = ariaLabel
    ? ariaLabel
    : safeValue
      ? `${label}: ${TOKEN_LABELS[safeValue]}`
      : `Pick ${label.toLowerCase()}`;

  return (
    <Popover
      position="bottom-start"
      shadow="md"
      opened={opened}
      onChange={setOpened}
      withinPortal
      trapFocus
      closeOnEscape
      closeOnClickOutside
      disabled={disabled}
    >
      <Popover.Target>
        <UnstyledButton
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpened(o => !o)}
          aria-haspopup="dialog"
          aria-expanded={opened}
          aria-label={triggerAriaLabel}
          data-testid="color-swatch-input-trigger"
          className={classes.trigger}
          data-disabled={disabled || undefined}
        >
          <Group gap={6} wrap="nowrap" align="center">
            {safeValue ? (
              <ColorSwatch
                color={getColorFromCSSToken(safeValue)}
                size={14}
                withShadow={false}
              />
            ) : (
              <IconCircleOff size={14} stroke={1.5} aria-hidden />
            )}
            <Text size="xs" c="dimmed">
              {safeValue ? TOKEN_LABELS[safeValue] : label}
            </Text>
          </Group>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="xs" style={{ zIndex: Z_INDEX }}>
        <Stack gap="xs">
          <div>
            <VisuallyHidden>Categorical colors</VisuallyHidden>
            <Text size="xs" c="dimmed" mb={4} aria-hidden>
              Categorical
            </Text>
            <SwatchGrid
              tokens={CATEGORICAL_PALETTE_TOKENS}
              value={safeValue}
              onSelect={handleChange}
            />
          </div>
          <div>
            <VisuallyHidden>Semantic colors</VisuallyHidden>
            <Text size="xs" c="dimmed" mb={4} aria-hidden>
              Semantic
            </Text>
            <SwatchGrid
              tokens={SEMANTIC_PALETTE_TOKENS}
              value={safeValue}
              onSelect={handleChange}
              cols={3}
            />
          </div>
          {safeValue && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<IconX size={12} stroke={1.5} />}
              onClick={() => handleChange(undefined)}
              data-testid="color-swatch-input-clear"
            >
              Clear
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

function SwatchGrid({
  tokens,
  value,
  onSelect,
  cols = 5,
}: {
  tokens: readonly ChartPaletteToken[];
  value: ChartPaletteToken | undefined;
  onSelect: (token: ChartPaletteToken) => void;
  cols?: number;
}) {
  return (
    <SimpleGrid cols={cols} spacing={4} verticalSpacing={4}>
      {tokens.map(token => {
        const selected = value === token;
        return (
          <Tooltip
            key={token}
            label={TOKEN_LABELS[token]}
            withArrow
            openDelay={200}
            zIndex={Z_INDEX + 1}
          >
            <ActionIcon
              size="md"
              radius="sm"
              variant="subtle"
              color="gray"
              onClick={() => onSelect(token)}
              data-testid={`color-swatch-option-${token}`}
              data-selected={selected || undefined}
              aria-label={TOKEN_LABELS[token]}
              aria-pressed={selected}
              className={classes.swatchButton}
            >
              <ColorSwatch
                color={getColorFromCSSToken(token)}
                size={16}
                withShadow={false}
              />
            </ActionIcon>
          </Tooltip>
        );
      })}
    </SimpleGrid>
  );
}
