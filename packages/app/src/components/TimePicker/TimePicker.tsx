import React, { useMemo, useState } from 'react';
import { add, Duration, format, sub } from 'date-fns';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Button,
  Card,
  CloseButton,
  Divider,
  Group,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Space,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput, DateInputProps } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';

import { useUserPreferences } from '@/useUserPreferences';

import { Icon } from '../Icon';

import { TimePickerMode } from './types';
import { useTimePickerForm } from './useTimePickerForm';
import {
  dateParser,
  DURATION_OPTIONS,
  DURATIONS,
  LIVE_TAIL_DURATION_MS,
  LIVE_TAIL_TIME_QUERY,
  parseTimeRangeInput,
  RELATIVE_TIME_OPTIONS,
} from './utils';

const modeAtom = atomWithStorage<TimePickerMode>(
  'hdx-time-picker-mode',
  TimePickerMode.Range,
);

const DATE_INPUT_PLACEHOLDER = 'YYY-MM-DD HH:mm:ss';
const DATE_INPUT_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const DateInputCmp = (props: DateInputProps) => (
  <DateInput
    size="xs"
    highlightToday
    placeholder={DATE_INPUT_PLACEHOLDER}
    valueFormat={DATE_INPUT_FORMAT}
    variant="filled"
    dateParser={dateParser}
    onKeyDown={e => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        e.target.blur();
      }
    }}
    {...props}
  />
);

const H = ({ children }: { children: React.ReactNode }) => (
  <Text size="xxs" c="dimmed" lh={1.1}>
    {children}
  </Text>
);

export const TimePicker = ({
  inputValue: value,
  setInputValue: onChange,
  onSearch,
  onRelativeSearch,
  onSubmit,
  showLive = false,
  isLiveMode = false,
  defaultRelativeTimeMode = false,
}: {
  inputValue: string;
  setInputValue: (str: string) => any;
  onRelativeSearch?: (rangeMs: number) => void;
  onSearch: (range: string) => void;
  onSubmit?: (rangeStr: string) => void;
  showLive?: boolean;
  isLiveMode?: boolean;
  defaultRelativeTimeMode?: boolean;
}) => {
  const {
    userPreferences: { timeFormat },
  } = useUserPreferences();

  const [opened, { close, toggle }] = useDisclosure(false);

  useHotkeys('d', () => toggle(), { preventDefault: true }, [toggle]);

  const today = React.useMemo(() => new Date(), []);

  const relativeTimeOptions = React.useMemo(() => {
    return [
      ...((showLive
        ? [[LIVE_TAIL_TIME_QUERY, LIVE_TAIL_DURATION_MS], 'divider' as const]
        : []) satisfies typeof RELATIVE_TIME_OPTIONS),
      ...RELATIVE_TIME_OPTIONS,
    ];
  }, [showLive]);

  const [mode, setMode] = useAtom(modeAtom);
  const form = useTimePickerForm({ mode });

  const dateRange = React.useMemo(() => {
    return parseTimeRangeInput(value);
  }, [value]);

  React.useEffect(() => {
    // Only update form values from external dateRange when popover is closed
    // This prevents overwriting user inputs while they're editing
    if (!opened && dateRange[0] && dateRange[1]) {
      if (mode === TimePickerMode.Range) {
        form.setValues({
          startDate: dateRange[0],
          endDate: dateRange[1],
        });
      } else if (mode === TimePickerMode.Around) {
        // For "Around a time" mode, set the startDate to the midpoint of the range
        const midpoint = new Date(
          (dateRange[0].getTime() + dateRange[1].getTime()) / 2,
        );
        form.setFieldValue('startDate', midpoint);
      }
    }
    // only run when dateRange changes or opened state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, opened, mode]);

  const handleRelativeSearch = React.useCallback(
    (label: string, value: number) => {
      onChange(label);
      onRelativeSearch?.(value);
      close();
    },
    [close, onChange, onRelativeSearch],
  );

  const handleSearch = React.useCallback(
    (value: string | [Date | null, Date | null]) => {
      if (typeof value === 'string') {
        onChange(value);
        onSearch(value);
        close();
        return;
      }

      const [from, to] = value;
      if (!from || !to) {
        return;
      }
      const formatStr =
        timeFormat === '24h' ? 'MMM d HH:mm:ss' : 'MMM d h:mm:ss a';
      const rangeStr = [from, to]
        .map(d => d && format(d, formatStr))
        .join(' - ');
      onChange(rangeStr);
      onSearch(rangeStr);
      close();
    },
    [close, onChange, onSearch, timeFormat],
  );

  const handleApply = React.useCallback(() => {
    if (!form.isValid() || !opened) {
      return;
    }
    const { startDate, endDate } = form.values;
    if (mode === TimePickerMode.Range) {
      handleSearch([startDate, endDate]);
      close();
    }
    if (mode === TimePickerMode.Around) {
      const duration = DURATIONS[form.values.duration];
      const from = startDate && sub(startDate, duration);
      const to = startDate && add(startDate, duration);
      handleSearch([from, to]);
      close();
    }
  }, [close, form, handleSearch, mode, opened]);

  useHotkeys('Enter', handleApply, [handleApply]);

  const handleMove = React.useCallback(
    (d: Duration) => {
      const { startDate, endDate } = form.values;
      const from = startDate && add(startDate, d);
      const to = endDate && add(endDate, d);
      handleSearch([from, to]);
    },
    [form.values, handleSearch],
  );

  const [isRelative, setIsRelative] = useState(defaultRelativeTimeMode);
  // Must be state to ensure rerenders occur when ref changes
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const dateComponentPopoverProps = useMemo(
    () => ({
      portalProps: {
        target: containerRef ?? undefined,
      },
    }),
    [containerRef],
  );

  return (
    <Popover
      position="bottom-start"
      closeOnEscape
      opened={opened}
      onClose={close}
    >
      <Popover.Target>
        <TextInput
          data-testid="time-picker-input"
          leftSection={
            isLiveMode ? (
              <Icon
                name="lightning-charge-fill"
                className="fs-8 text-success"
              />
            ) : (
              <Icon name="calendar-fill" className="fs-8" />
            )
          }
          styles={{
            input: {
              color: isLiveMode
                ? 'var(--mantine-color-green-5)'
                : 'var(--mantine-color-gray-1)',
            },
          }}
          rightSection={
            opened && (
              <Text size="xxs" bg="gray.8" px={4}>
                d
              </Text>
            )
          }
          value={value}
          onChange={event => onChange(event.currentTarget.value)}
          onClick={toggle}
          placeholder="Time Range"
          size="sm"
          w={350}
          onKeyDown={e => {
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              onSubmit?.(e.target.value);
              close();
            }
            if (e.key === 'Escape' && e.target instanceof HTMLInputElement) {
              e.target.blur();
              close();
            }
          }}
        />
      </Popover.Target>
      <Popover.Dropdown
        p={0}
        data-testid="time-picker-popover"
        ref={setContainerRef}
      >
        <Group justify="space-between" gap={4} px="xs" py={4}>
          <Group gap={4}>
            {typeof onRelativeSearch === 'function' && (
              <Tooltip
                label="Set how far back Live Tail begins streaming logs."
                refProp="rootRef"
              >
                <Switch
                  data-testid="time-picker-relative-switch"
                  size="xs"
                  checked={isRelative}
                  onChange={e => setIsRelative(e.currentTarget.checked)}
                  label="Relative Time"
                  labelPosition="right"
                  styles={{
                    label: {
                      paddingLeft: '5px',
                    },
                  }}
                />
              </Tooltip>
            )}
          </Group>
          <Group gap={4}>
            <Button
              data-testid="time-picker-1h-back"
              size="compact-xs"
              color="gray"
              variant="light"
              onClick={handleMove.bind(null, { hours: -1 })}
              disabled={isLiveMode || isRelative}
            >
              1h back
            </Button>
            <Button
              data-testid="time-picker-1h-forward"
              size="compact-xs"
              color="gray"
              variant="light"
              onClick={handleMove.bind(null, { hours: 1 })}
              disabled={isLiveMode || isRelative}
            >
              1h forward
            </Button>
            <CloseButton data-testid="time-picker-close" onClick={close} />
          </Group>
        </Group>
        <Group gap={1} align="stretch">
          <Card w={180} p={0}>
            <ScrollArea h={300} scrollbarSize={5}>
              <Stack gap={0} p="xs">
                {relativeTimeOptions.map((item, index) =>
                  item === 'divider' ? (
                    <Divider key={index} my={4} color="gray.9" />
                  ) : (
                    <Button
                      key={item[0]}
                      disabled={
                        isRelative &&
                        !item[2] &&
                        item[0] !== LIVE_TAIL_TIME_QUERY
                      }
                      onClick={() => {
                        if (isRelative || item[0] === LIVE_TAIL_TIME_QUERY) {
                          handleRelativeSearch?.(item[0], item[1]);
                        } else {
                          handleSearch(item[0]);
                        }
                      }}
                      w="100%"
                      size="compact-xs"
                      color="gray"
                      variant={value === item[0] ? 'filled' : 'subtle'}
                      fw="normal"
                      fz="xs"
                      fullWidth
                      justify="space-between"
                    >
                      {item[0]}
                    </Button>
                  ),
                )}
              </Stack>
            </ScrollArea>
          </Card>
          <Card w={280} p="xs">
            <Stack gap={8} mb="sm">
              <SegmentedControl
                size="xs"
                mb="xs"
                data={[TimePickerMode.Range, TimePickerMode.Around]}
                value={mode}
                disabled={isRelative}
                onChange={newMode => {
                  const value = newMode as TimePickerMode;
                  setMode(value);
                  // When switching to "Around a time", calculate the center point and appropriate duration
                  if (
                    value === TimePickerMode.Around &&
                    form.values.startDate &&
                    form.values.endDate
                  ) {
                    const midpoint = new Date(
                      (form.values.startDate.getTime() +
                        form.values.endDate.getTime()) /
                        2,
                    );
                    const halfRangeMs =
                      (form.values.endDate.getTime() -
                        form.values.startDate.getTime()) /
                      2;

                    // Find the closest duration option
                    const halfRangeMinutes = halfRangeMs / (1000 * 60);
                    let closestDuration = '15m'; // default

                    if (halfRangeMinutes <= 0.5) closestDuration = '30s';
                    else if (halfRangeMinutes <= 1) closestDuration = '1m';
                    else if (halfRangeMinutes <= 5) closestDuration = '5m';
                    else if (halfRangeMinutes <= 15) closestDuration = '15m';
                    else if (halfRangeMinutes <= 30) closestDuration = '30m';
                    else if (halfRangeMinutes <= 60) closestDuration = '1h';
                    else if (halfRangeMinutes <= 180) closestDuration = '3h';
                    else if (halfRangeMinutes <= 360) closestDuration = '6h';
                    else closestDuration = '12h';

                    form.setValues({
                      startDate: midpoint,
                      duration: closestDuration,
                    });
                  }
                }}
              />
              {mode === TimePickerMode.Range ? (
                <>
                  <H>Start time</H>
                  <DateInputCmp
                    disabled={isRelative}
                    popoverProps={dateComponentPopoverProps}
                    maxDate={today}
                    mb="xs"
                    {...form.getInputProps('startDate')}
                  />
                  <H>End time</H>
                  <DateInputCmp
                    popoverProps={dateComponentPopoverProps}
                    maxDate={today}
                    minDate={form.values.startDate ?? undefined}
                    disabled={isRelative}
                    {...form.getInputProps('endDate')}
                  />
                </>
              ) : (
                <>
                  <H>Time</H>
                  <DateInputCmp
                    disabled={isRelative}
                    popoverProps={dateComponentPopoverProps}
                    maxDate={today}
                    mb="xs"
                    {...form.getInputProps('startDate')}
                  />
                  <H>Duration ±</H>
                  <Select
                    placeholder="Pick value"
                    data={DURATION_OPTIONS}
                    comboboxProps={dateComponentPopoverProps}
                    searchable
                    size="xs"
                    disabled={isRelative}
                    variant="filled"
                    {...form.getInputProps('duration')}
                  />
                </>
              )}
            </Stack>
            <Text size="xxs" lh={1.2} c="gray.7">
              You can use natural language to select dates (e.g. yesterday, last
              monday at 5pm)
            </Text>
            <Space flex={1} />
            <Group
              justify="flex-end"
              mt={8}
              pt={8}
              style={{ borderTop: '1px solid #282828' }}
            >
              <Button
                data-testid="time-picker-apply"
                size="compact-sm"
                variant="light"
                disabled={!form.isValid() || isRelative}
                onClick={handleApply}
              >
                Apply
              </Button>
            </Group>
          </Card>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
};
