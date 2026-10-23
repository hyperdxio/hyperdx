import { ComboboxProps, Group, Stack, Text } from '@mantine/core';

import { TimeZoneSelect, TimeZoneShortcuts } from '@/components/TimeZoneSelect';
import { getLocalTimeZone, getTimeZoneShortName } from '@/timeZone';
import { useTimeZoneOverride } from '@/timeZoneOverride';
import { useDisplayTimeZone } from '@/useDisplayTimeZone';
import { useUserPreferences } from '@/useUserPreferences';

/**
 * Short name of the zone the picker reads and shows times in, highlighted
 * when it isn't the browser's.
 */
export function TimePickerTimeZoneBadge() {
  const timeZone = useDisplayTimeZone();
  return (
    <Text
      data-testid="time-picker-time-zone"
      size="xxs"
      fw={600}
      variant={timeZone ? 'warning' : undefined}
      c={timeZone ? undefined : 'dimmed'}
    >
      {getTimeZoneShortName(timeZone ?? getLocalTimeZone())}
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
