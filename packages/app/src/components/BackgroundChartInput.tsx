import { BackgroundChart } from '@hyperdx/common-utils/dist/types';
import { Box, NumberInput, Select, Text, TextInput } from '@mantine/core';

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
 * override; when unset the sparkline inherits the tile's static color. An
 * optional reference line marks a value on the sparkline (for example a 0
 * error-budget line, an SLA, or a target).
 */
export function BackgroundChartInput({
  value,
  onChange,
}: {
  value?: BackgroundChart;
  onChange: (value: BackgroundChart | undefined) => void;
}) {
  const referenceLine = value?.referenceLine;

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
            onChange({ ...value, type: next });
          } else {
            onChange(undefined);
          }
        }}
      />
      {value && (
        <>
          <Box mt="xs">
            <Text size="xs" c="dimmed" mb={4}>
              Background color
            </Text>
            <ColorSwatchInput
              value={value.color}
              onChange={color => onChange({ ...value, color })}
              ariaLabel="Number tile background chart color"
            />
          </Box>

          <Box mt="xs">
            <Text size="xs" c="dimmed" mb={4}>
              Reference line
            </Text>
            <NumberInput
              size="xs"
              placeholder="Value (e.g. 0 for an error budget, or an SLA)"
              value={referenceLine?.value ?? ''}
              onChange={v => {
                if (v === '' || v == null) {
                  // Clearing the value removes the reference line entirely.
                  const { referenceLine: _drop, ...rest } = value;
                  onChange(rest);
                } else {
                  onChange({
                    ...value,
                    referenceLine: { ...referenceLine, value: Number(v) },
                  });
                }
              }}
            />
          </Box>

          {referenceLine && (
            <>
              <Box mt="xs">
                <Text size="xs" c="dimmed" mb={4}>
                  Reference line label
                </Text>
                <TextInput
                  size="xs"
                  maxLength={40}
                  placeholder="Optional (e.g. Budget, SLA)"
                  value={referenceLine.label ?? ''}
                  onChange={e =>
                    onChange({
                      ...value,
                      referenceLine: {
                        ...referenceLine,
                        label: e.currentTarget.value || undefined,
                      },
                    })
                  }
                />
              </Box>
              <Box mt="xs">
                <Text size="xs" c="dimmed" mb={4}>
                  Reference line color
                </Text>
                <ColorSwatchInput
                  value={referenceLine.color}
                  onChange={color =>
                    onChange({
                      ...value,
                      referenceLine: { ...referenceLine, color },
                    })
                  }
                  ariaLabel="Reference line color"
                />
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
