import { useTranslation } from 'react-i18next';
import { BackgroundChart } from '@hyperdx/common-utils/dist/types';
import { Box, Select, Text } from '@mantine/core';

import { ColorSwatchInput } from './ColorSwatchInput';

/**
 * Editor for a number tile's optional background sparkline. The type select
 * drives the `backgroundChart` config object: "None" clears it, "Line" /
 * "Area" set the shape. The color swatch is an optional palette-token
 * override; when unset the sparkline inherits the tile's static color.
 *
 * `disabled` is set for raw SQL number tiles, which have no time dimension to
 * bucket: the control stays visible but inert with a hint, so the option is
 * discoverable rather than missing.
 */
export function BackgroundChartInput({
  value,
  onChange,
  disabled = false,
}: {
  value?: BackgroundChart;
  onChange: (value: BackgroundChart | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('charts');
  const typeOptions = [
    { value: 'none', label: t('background.none') },
    { value: 'line', label: t('background.line') },
    { value: 'area', label: t('background.area') },
  ];
  return (
    <Box>
      <Text size="xs" c="dimmed" mb={4}>
        {t('background.backgroundChart')}
      </Text>
      <Select
        size="xs"
        data={typeOptions}
        value={value?.type ?? 'none'}
        disabled={disabled}
        allowDeselect={false}
        comboboxProps={{ withinPortal: false }}
        aria-label={t('background.typeAriaLabel')}
        onChange={next => {
          if (next === 'line' || next === 'area') {
            onChange({ ...value, type: next });
          } else {
            onChange(undefined);
          }
        }}
      />
      {disabled ? (
        <Text size="xs" c="dimmed" mt={4}>
          {t('background.availableHint')}
        </Text>
      ) : (
        value && (
          <Box mt="xs">
            <Text size="xs" c="dimmed" mb={4}>
              {t('background.backgroundColor')}
            </Text>
            <ColorSwatchInput
              value={value.color}
              onChange={color => onChange({ ...value, color })}
              ariaLabel={t('background.colorAriaLabel')}
            />
          </Box>
        )
      )}
    </Box>
  );
}
