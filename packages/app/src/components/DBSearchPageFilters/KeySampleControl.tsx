import type { KeySample } from '@hyperdx/common-utils/dist/core/metadata';
import { SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';

const KEY_SAMPLE_LEVELS = [
  { label: 'Auto', value: '0' },
  { label: '10%', value: '0.1' },
  { label: '50%', value: '0.5' },
  { label: '100%', value: '1' },
];

const formatParts = (count: number) =>
  `${count} ${count === 1 ? 'part' : 'parts'}`;

/** How many data parts filter keys come from, with a control to read more. */
export function KeySampleControl({
  sample,
  ratio,
  onRatioChange,
}: {
  sample: KeySample | null | undefined;
  ratio: number;
  onRatioChange: (ratio: number) => void;
}) {
  if (!sample || sample.totalParts === 0) return null;
  const readsAllParts = sample.sampledParts >= sample.totalParts;

  return (
    <Stack gap={4} data-testid="key-sample-control">
      <Tooltip
        label="Map keys (e.g. LogAttributes), and filter values when all values are shown, are read from a sample of recent data parts. Read more parts to find rarer ones."
        multiline
        w={220}
        position="right"
        withArrow
        fz="xxs"
        color="gray"
      >
        <Text size="xxs" c="dimmed">
          {readsAllParts
            ? `Read from all ${formatParts(sample.totalParts)}`
            : `Sampled from ${sample.sampledParts} of ${formatParts(sample.totalParts)}`}
        </Text>
      </Tooltip>
      {/* Keep the control once a larger sample is picked, so it can be undone. */}
      {(!readsAllParts || ratio > 0) && (
        <SegmentedControl
          size="xs"
          fullWidth
          data={KEY_SAMPLE_LEVELS}
          value={String(ratio)}
          onChange={value => onRatioChange(Number(value))}
          data-testid="key-sample-ratio"
        />
      )}
    </Stack>
  );
}
