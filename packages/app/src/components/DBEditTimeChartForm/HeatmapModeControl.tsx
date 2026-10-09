import { PromqlHeatmapMode } from '@hyperdx/common-utils/dist/types';
import { Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

type ModeOption = { label: string; value: PromqlHeatmapMode; help: string };

const BUILDER_MODE_OPTIONS: ModeOption[] = [
  {
    label: 'Distribution',
    value: 'distribution',
    help: 'Buckets each event by a value, such as duration. Color shows how many events fall in each bucket.',
  },
  {
    label: 'Series',
    value: 'series',
    help: 'One row per group. Color shows the aggregated value.',
  },
];

const PROMQL_MODE_OPTIONS: ModeOption[] = [
  {
    label: 'Distribution',
    value: 'distribution',
    help: 'Buckets the samples of every series by value. Color shows how many samples fall in each bucket.',
  },
  {
    label: 'Series',
    value: 'series',
    help: 'One row per series. Color shows the sample value.',
  },
  {
    label: 'Histogram',
    value: 'histogram',
    help: "One row per le bucket of a Prometheus histogram. Color shows the query's value for that bucket alone, such as a rate or count.",
  },
];

/** Histogram mode is offered only where `allowHistogram` is set (PromQL). */
export function HeatmapModeControl<M extends PromqlHeatmapMode>({
  mode,
  onModeChange,
  allowHistogram = false,
}: {
  mode: M;
  onModeChange: (mode: M) => void;
  allowHistogram?: boolean;
}) {
  const options = allowHistogram ? PROMQL_MODE_OPTIONS : BUILDER_MODE_OPTIONS;
  const isOfferedMode = (value: string): value is M =>
    options.some(o => o.value === value);
  return (
    <Group gap="xs">
      <SegmentedControl
        size="xs"
        w="fit-content"
        value={mode}
        onChange={value => {
          if (isOfferedMode(value)) onModeChange(value);
        }}
        data={options.map(({ label, value }) => ({ label, value }))}
        data-testid="heatmap-mode-control"
      />
      <Tooltip
        multiline
        w={320}
        label={
          <Stack gap={4}>
            {options.map(({ label, help }) => (
              <Text key={label} size="xs">
                <b>{label}:</b> {help}
              </Text>
            ))}
          </Stack>
        }
      >
        <IconHelpCircle
          size={16}
          opacity={0.5}
          aria-label="Heatmap modes"
          data-testid="heatmap-mode-help"
        />
      </Tooltip>
    </Group>
  );
}
