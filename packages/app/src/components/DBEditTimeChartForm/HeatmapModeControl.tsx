import { HeatmapMode } from '@hyperdx/common-utils/dist/types';
import { SegmentedControl } from '@mantine/core';

export function HeatmapModeControl({
  mode,
  onModeChange,
}: {
  mode: HeatmapMode;
  onModeChange: (mode: HeatmapMode) => void;
}) {
  return (
    <SegmentedControl
      size="xs"
      w="fit-content"
      value={mode}
      onChange={value => {
        if (value === 'distribution' || value === 'series') {
          onModeChange(value);
        }
      }}
      data={[
        { label: 'Distribution', value: 'distribution' },
        { label: 'Series', value: 'series' },
      ]}
      data-testid="heatmap-mode-control"
    />
  );
}
