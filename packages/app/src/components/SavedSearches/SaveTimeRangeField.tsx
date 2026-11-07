import { useMemo, useState } from 'react';
import { RelativeDateRange } from '@hyperdx/common-utils/dist/types';
import { Radio, Stack, Text } from '@mantine/core';

import {
  CurrentTimeRange,
  formatRelativeDuration,
  getTimeRangeChoices,
  resolveDefaultTimeRange,
  TimeRangeChoice,
} from './savedSearchTimeRange';

function isTimeRangeChoice(value: string): value is TimeRangeChoice {
  return value === 'live' || value === 'keep' || value === 'current';
}

export function useSaveTimeRangeField({
  openedAtMs,
  isLive,
  searchedTimeRange,
  stored,
}: {
  /** When the modal was opened, or null while it is closed. */
  openedAtMs: number | null;
  isLive: boolean;
  searchedTimeRange: [Date, Date];
  stored: RelativeDateRange | null | undefined;
}) {
  // Live updates pause while the save modal is open, so the window is stable.
  const options = useMemo(() => {
    const current: CurrentTimeRange =
      isLive || openedAtMs == null
        ? { kind: 'live' }
        : { kind: 'window', range: searchedTimeRange };
    return getTimeRangeChoices({
      current,
      stored,
      nowMs: openedAtMs ?? 0,
    });
  }, [openedAtMs, isLive, searchedTimeRange, stored]);

  // A pick only counts for the opening it was made in. Until then the default
  // applies, which can change once the stored saved search loads.
  const [picked, setPicked] = useState<{
    openedAtMs: number | null;
    choice: TimeRangeChoice;
  } | null>(null);
  const pickedChoice =
    picked != null && picked.openedAtMs === openedAtMs ? picked.choice : null;

  const choice =
    pickedChoice != null && options.choices.includes(pickedChoice)
      ? pickedChoice
      : options.defaultChoice;

  return {
    ...options,
    isLive,
    stored,
    choice,
    setChoice: (next: TimeRangeChoice) =>
      setPicked({ openedAtMs, choice: next }),
    resolve: (isUpdate: boolean) =>
      resolveDefaultTimeRange({
        isUpdate,
        choice,
        stored,
        currentRange: options.currentRange,
      }),
  };
}

export function SaveTimeRangeField({
  field,
}: {
  field: ReturnType<typeof useSaveTimeRangeField>;
}) {
  const { choices, choice, setChoice, stored, currentRange, isLive } = field;

  return (
    <Stack gap="xs">
      <Radio.Group
        data-testid="save-search-time-range"
        label="When opened"
        size="xs"
        value={choice}
        onChange={value => {
          if (isTimeRangeChoice(value)) setChoice(value);
        }}
      >
        <Stack gap="xs" mt="xs">
          <Radio value="live" label="Show live tail" />
          {choices.includes('keep') && stored != null && (
            <Radio
              value="keep"
              label={`Show the saved time range (past ${formatRelativeDuration(stored.value)})`}
            />
          )}
          {choices.includes('current') && currentRange != null && (
            <Radio
              value="current"
              label={`Show the past ${formatRelativeDuration(currentRange.value)}`}
            />
          )}
        </Stack>
      </Radio.Group>
      {choices.length === 1 && (
        <Text size="xs" c="dimmed">
          {isLive
            ? 'Live tail is the default. To save a time range, pick one first.'
            : 'To save a time range, pick one that ends now.'}
        </Text>
      )}
    </Stack>
  );
}
