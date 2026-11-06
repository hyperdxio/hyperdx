import { useCallback, useMemo } from 'react';
import { UTC_TIME_ZONE } from '@hyperdx/common-utils/dist/core/utils';
import {
  Box,
  Button,
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
  getTimeZonePreferenceLabel,
  getTimeZoneShortName,
  LOCAL_TIME_ZONE,
  resolveTimeZonePreference,
} from '@/timeZone';

type TimeZoneSelectProps = Omit<
  SelectProps,
  'value' | 'onChange' | 'data' | 'renderOption'
> & {
  /**
   * A time zone setting: `LOCAL_TIME_ZONE` or an IANA name, or null for the
   * default option.
   */
  value: string | null;
  onChange: (value: string | null) => void;
  /**
   * The setting the default option stands for, such as the user's. Adds a
   * "Default (…)" option, pinned first, that selects null.
   */
  defaultTimeZone?: string;
};

const DEFAULT_OPTION = '__default';

type ZoneOption = { value: string; name: string; offset?: string };

function getDefaultOption(preference: string): ZoneOption {
  const timeZone = resolveTimeZonePreference(preference);
  return {
    value: DEFAULT_OPTION,
    name: `Default (${getTimeZonePreferenceLabel(preference)})`,
    offset:
      timeZone === UTC_TIME_ZONE
        ? undefined
        : getTimeZoneShortName(timeZone ?? getLocalTimeZone()),
  };
}

// The label is what the input shows and what search matches.
function toComboboxItem({ value, name, offset }: ZoneOption): ComboboxItem {
  return { value, label: offset ? `${name} ${offset}` : name };
}

/**
 * Picks a time zone setting. Local and UTC are pinned above every zone the
 * browser knows.
 */
export function TimeZoneSelect({
  value,
  onChange,
  defaultTimeZone,
  ...props
}: TimeZoneSelectProps) {
  const selected =
    value == null && defaultTimeZone != null
      ? DEFAULT_OPTION
      : (resolveTimeZonePreference(value ?? LOCAL_TIME_ZONE) ??
        LOCAL_TIME_ZONE);

  const zones = useMemo(() => {
    const supported = getSupportedTimeZones();

    const isPinned =
      selected === DEFAULT_OPTION ||
      selected === LOCAL_TIME_ZONE ||
      selected === UTC_TIME_ZONE;

    const isListed = supported.includes(selected);

    if (isPinned || isListed) {
      return supported;
    }

    return [...supported, selected];
  }, [selected]);

  const { data, optionsByValue } = useMemo(() => {
    const localZone = getLocalTimeZone();
    const pinned: ZoneOption[] = [
      ...(defaultTimeZone != null ? [getDefaultOption(defaultTimeZone)] : []),
      {
        value: LOCAL_TIME_ZONE,
        name: `Local (${formatTimeZoneName(localZone)})`,
        offset: getTimeZoneShortName(localZone),
      },
      // UTC's name is already its offset.
      { value: UTC_TIME_ZONE, name: 'UTC' },
    ];
    const listed: ZoneOption[] = zones.map(zone => ({
      value: zone,
      name: formatTimeZoneName(zone),
      offset: getTimeZoneShortName(zone),
    }));

    return {
      data: [
        ...pinned.map(toComboboxItem),
        { group: 'All time zones', items: listed.map(toComboboxItem) },
      ] satisfies ComboboxData,
      optionsByValue: new Map(
        [...pinned, ...listed].map(option => [option.value, option]),
      ),
    };
  }, [zones, defaultTimeZone]);

  const renderOption = useCallback(
    ({ option, checked }: { option: ComboboxItem; checked?: boolean }) => {
      const zone = optionsByValue.get(option.value);
      return (
        <Group w="100%">
          <Box flex={1}>
            <Text fz="sm">{zone?.name ?? option.label}</Text>

            {zone?.offset && (
              <Text size="xs" c="dimmed">
                {zone.offset}
              </Text>
            )}
          </Box>

          {checked && (
            <IconCheck size={14} color="var(--color-text-brand)" stroke={2.5} />
          )}
        </Group>
      );
    },
    [optionsByValue],
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
      onChange={next => {
        if (next != null) {
          onChange(next === DEFAULT_OPTION ? null : next);
        }
      }}
      renderOption={renderOption}
    />
  );
}

/**
 * One-click "UTC" and "Local" buttons, for under a `TimeZoneSelect`. With
 * `onSelectDefault`, a "Default" button comes first.
 */
export function TimeZoneShortcuts({
  onSelect,
  onSelectDefault,
  testIdPrefix,
}: {
  onSelect: (timeZone: string) => void;
  onSelectDefault?: () => void;
  testIdPrefix: string;
}) {
  return (
    <Group gap={4}>
      {onSelectDefault && (
        <Button
          data-testid={`${testIdPrefix}-default`}
          size="compact-xs"
          variant="secondary"
          onClick={onSelectDefault}
        >
          Default
        </Button>
      )}
      <Button
        data-testid={`${testIdPrefix}-utc`}
        size="compact-xs"
        variant="secondary"
        onClick={() => onSelect(UTC_TIME_ZONE)}
      >
        UTC
      </Button>
      <Button
        data-testid={`${testIdPrefix}-local`}
        size="compact-xs"
        variant="secondary"
        onClick={() => onSelect(LOCAL_TIME_ZONE)}
      >
        Local
      </Button>
    </Group>
  );
}
