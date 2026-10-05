import { Box, SegmentedControl, Text } from '@mantine/core';

import type { HeatmapScaleType } from './heatmapGrid';

const SCALE_OPTIONS: { label: string; value: HeatmapScaleType }[] = [
  { label: 'Log', value: 'log' },
  { label: 'Linear', value: 'linear' },
];

export function HeatmapScaleControl({
  value,
  onChange,
}: {
  value: HeatmapScaleType;
  onChange: (value: HeatmapScaleType) => void;
}) {
  return (
    <Box>
      <Text size="xs" mb={4}>
        Y axis scale
      </Text>
      <SegmentedControl
        size="xs"
        value={value}
        onChange={v => {
          if (v === 'log' || v === 'linear') onChange(v);
        }}
        data={SCALE_OPTIONS}
        data-testid="heatmap-scale-control"
      />
    </Box>
  );
}
