import { useMemo } from 'react';
import { ComboboxProps, Group, Stack, Text } from '@mantine/core';

import { TimeZoneSelect, TimeZoneShortcuts } from '@/components/TimeZoneSelect';
import {
  getLocalTimeZone,
  getTimeZoneRangeShortName,
  getTimeZoneShortName,
} from '@/timeZone';
import { useTimeZoneOverride } from '@/timeZoneOverride';
import { useDisplayTimeZone } from '@/useDisplayTimeZone';
import { useUserPreferences } from '@/useUserPreferences';

/**
 * Offset of the zone the picker reads and shows times in, during `range`
 * (now if it didn't parse), and whether it is the browser's zone.
 */
export function useTimePickerTimeZoneLabel(
  range: readonly [Date | null, Date | null],
): { label: string; isLocal: boolean } {
  const localTimeZone = getLocalTimeZone();
  const timeZone = useDisplayTimeZone() ?? localTimeZone;
  const startMs = range[0]?.getTime();
  const endMs = range[1]?.getTime();
  return useMemo(
    () => ({
      label:
        startMs != null && endMs != null
          ? getTimeZoneRangeShortName(timeZone, [
              new Date(startMs),
              new Date(endMs),
            ])
          : getTimeZoneShortName(timeZone),
      isLocal: timeZone === localTimeZone,
    }),
    [timeZone, localTimeZone, startMs, endMs],
  );
}

/** The zone's offset, highlighted when it isn't the browser's zone. */
export function TimePickerTimeZoneBadge({
  label,
  isLocal,
}: {
  label: string;
  isLocal: boolean;
}) {
  return (
    <Text
      data-testid="time-picker-time-zone"
      data-local={isLocal}
      size="xxs"
      fw={600}
      variant={isLocal ? undefined : 'warning'}
      c={isLocal ? 'dimmed' : undefined}
    >
      {label}
    </Text>
  );
}

/** Sets the page's time zone override. Renders nothing without one. */
export function TimePickerTimeZoneSelect({
  comboboxProps,
}: {
  comboboxProps: ComboboxProps;
}) {
  const override = useTimeZoneOverride();
  const {
    userPreferences: { timeZone: userTimeZone },
  } = useUserPreferences();

  if (override == null) {
    return null;
  }

  return (
    <Group
      gap="xs"
      px="xs"
      py={6}
      wrap="nowrap"
      align="flex-start"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      <Text size="xs" c="dimmed" lh="30px">
        Time zone
      </Text>
      <Stack gap={4} flex={1}>
        <TimeZoneSelect
          data-testid="time-picker-time-zone-select"
          size="xs"
          value={override.timeZone}
          onChange={override.setTimeZone}
          defaultTimeZone={userTimeZone}
          comboboxProps={comboboxProps}
        />
        <TimeZoneShortcuts
          testIdPrefix="time-picker-time-zone"
          onSelect={override.setTimeZone}
          onSelectDefault={() => override.setTimeZone(null)}
        />
      </Stack>
    </Group>
  );
}
