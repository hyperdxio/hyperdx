import { useCallback, useMemo } from 'react';
import { UTC_TIME_ZONE } from '@hyperdx/common-utils/dist/core/utils';
import {
  Box,
  ComboboxData,
  ComboboxItem,
  Group,
  Select,
  SelectProps,
  Text,
} from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

import {
  formatTimeZoneName,
  getLocalTimeZone,
  getSupportedTimeZones,
  getTimeZoneOffsetLabel,
  getTimeZoneShortName,
  LOCAL_TIME_ZONE,
  resolveTimeZonePreference,
} from '@/timeZone';

type TimeZoneSelectProps = Omit<
  SelectProps,
  'value' | 'onChange' | 'data' | 'renderOption'
> & {
  /** A time zone setting: `LOCAL_TIME_ZONE` or an IANA name. */
  value: string;
  onChange: (value: string) => void;
};

/** Offsets shown next to each option, keyed by option value. */
function getOffsetLabels(zones: string[]): Map<string, string> {
  const localZone = getLocalTimeZone();

  return new Map([
    [
      LOCAL_TIME_ZONE,
      `${getTimeZoneShortName(localZone)} · ${getTimeZoneOffsetLabel(localZone)}`,
    ],
    [UTC_TIME_ZONE, getTimeZoneOffsetLabel(UTC_TIME_ZONE)],
    ...zones.map(zone => [zone, getTimeZoneOffsetLabel(zone)] as const),
  ]);
}

/**
 * Picks a time zone setting. Local and UTC are pinned above every zone the
 * browser knows.
 */
export function TimeZoneSelect({
  value,
  onChange,
  ...props
}: TimeZoneSelectProps) {
  const selected = resolveTimeZonePreference(value) ?? LOCAL_TIME_ZONE;

  const zones = useMemo(() => {
    const supported = getSupportedTimeZones();

    const isPinned = selected === LOCAL_TIME_ZONE || selected === UTC_TIME_ZONE;

    const isListed = supported.includes(selected);

    if (isPinned || isListed) {
      return supported;
    }

    return [...supported, selected];
  }, [selected]);

  const data = useMemo<ComboboxData>(
    () => [
      {
        value: LOCAL_TIME_ZONE,
        label: `Local (${formatTimeZoneName(getLocalTimeZone())})`,
      },
      { value: UTC_TIME_ZONE, label: 'UTC' },
      {
        group: 'All time zones',
        items: zones.map(zone => ({
          value: zone,
          label: formatTimeZoneName(zone),
        })),
      },
    ],
    [zones],
  );

  const offsetLabels = useMemo(() => getOffsetLabels(zones), [zones]);

  const renderOption = useCallback(
    ({ option, checked }: { option: ComboboxItem; checked?: boolean }) => (
      <Group w="100%">
        <Box flex={1}>
          <Text fz="sm">{option.label}</Text>

          <Text size="xs" c="dimmed">
            {offsetLabels.get(option.value)}
          </Text>
        </Box>

        {checked && (
          <IconCheck size={14} color="var(--color-text-brand)" stroke={2.5} />
        )}
      </Group>
    ),
    [offsetLabels],
  );

  return (
    <Select
      searchable
      allowDeselect={false}
      maxDropdownHeight={280}
      nothingFoundMessage="No matching time zones"
      {...props}
      data={data}
      value={selected}
      onChange={next => next && onChange(next)}
      renderOption={renderOption}
    />
  );
}
