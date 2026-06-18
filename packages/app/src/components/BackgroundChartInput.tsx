import { BackgroundChart } from '@hyperdx/common-utils/dist/types';
import { Box, Select, Text } from '@mantine/core';

import { ColorSwatchInput } from './ColorSwatchInput';

const TYPE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
];

/**
 * Editor for a number tile's optional background sparkline. The type select
 * drives the `backgroundChart` config object: "None" clears it, "Line" /
 * "Area" set the shape. The color swatch is an optional palette-token
 * override; when left unset the sparkline inherits the tile's static color.
 */
export function BackgroundChartInput({
  value,
  onChange,
}: {
  value?: BackgroundChart;
  onChange: (value: BackgroundChart | undefined) => void;
}) {
  return (
    <Box>
      <Text size="xs" c="dimmed" mb={4}>
        Background chart
      </Text>
      <Select
        size="xs"
        data={TYPE_OPTIONS}
        value={value?.type ?? 'none'}
        allowDeselect={false}
        comboboxProps={{ withinPortal: false }}
        aria-label="Number tile background chart type"
        onChange={next => {
          if (next === 'line' || next === 'area') {
            onChange({ type: next, color: value?.color });
          } else {
            onChange(undefined);
          }
        }}
      />
      {value && (
        <Box mt="xs">
          <Text size="xs" c="dimmed" mb={4}>
            Background color
          </Text>
          <ColorSwatchInput
            value={value.color}
            onChange={color => onChange({ type: value.type, color })}
            ariaLabel="Number tile background chart color"
          />
        </Box>
      )}
    </Box>
  );
}
