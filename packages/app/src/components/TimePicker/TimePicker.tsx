import React from 'react';
import { add, Duration, format, sub } from 'date-fns';
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
  Text,
  TextInput,
} from '@mantine/core';
import { DateInput, DateInputProps } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';

import { useUserPreferences } from '@/useUserPreferences';

import { Icon } from '../Icon';

import { useTimePickerForm } from './useTimePickerForm';
import {
  dateParser,
  DURATION_OPTIONS,
  DURATIONS,
  parseTimeRangeInput,
  RELATIVE_TIME_OPTIONS,
} from './utils';

const DATE_INPUT_PLACEHOLDER = 'YYY-MM-DD HH:mm:ss';
const DATE_INPUT_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const LIVE_TAIL_TIME_QUERY = 'Live Tail';

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
  onSubmit,
  showLive = false,
}: {
  inputValue: string;
  setInputValue: (str: string) => any;
  onSearch: (rangeStr: string) => void;
  onSubmit?: (rangeStr: string) => void;
  showLive?: boolean;
}) => {
  const {
    userPreferences: { timeFormat },
  } = useUserPreferences();

  const [opened, { close, toggle }] = useDisclosure(false);

  useHotkeys('d', () => toggle(), { preventDefault: true }, [toggle]);

  const today = React.useMemo(() => new Date(), []);

  const relativeTimeOptions = React.useMemo(() => {
    return [
      ...(showLive ? [['Live Tail', LIVE_TAIL_TIME_QUERY]] : []),
      ...RELATIVE_TIME_OPTIONS,
    ];
  }, [showLive]);

  const form = useTimePickerForm();

  const dateRange = React.useMemo(() => {
    return parseTimeRangeInput(value);
  }, [value]);

  React.useEffect(() => {
    if (dateRange[0] && dateRange[1]) {
      form.setValues({
        startDate: dateRange[0],
        endDate: dateRange[1],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

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
    if (form.values.mode === 'Time range') {
      handleSearch([startDate, endDate]);
      close();
    }
    if (form.values.mode === 'Around a time') {
      const duration = DURATIONS[form.values.duration];
      const from = startDate && sub(startDate, duration);
      const to = startDate && add(startDate, duration);
      handleSearch([from, to]);
      close();
    }
  }, [close, form, handleSearch, opened]);

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

  const isLiveMode = value === LIVE_TAIL_TIME_QUERY;

  return (
    <Popover
      position="bottom-start"
      closeOnClickOutside={false}
      closeOnEscape
      opened={opened}
      onClose={close}
    >
      <Popover.Target>
        <TextInput
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
          variant="filled"
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
      <Popover.Dropdown p={0}>
        <Group justify="space-between" gap={4} px="xs" py={6}>
          <Group gap={4}>
            <Button
              size="compact-sm"
              color="gray"
              variant="light"
              onClick={handleMove.bind(null, { hours: -1 })}
              disabled={isLiveMode}
            >
              1h back
            </Button>
            <Button
              size="compact-sm"
              color="gray"
              variant="light"
              onClick={handleMove.bind(null, { hours: 1 })}
              disabled={isLiveMode}
            >
              1h forward
            </Button>
          </Group>
          <Group gap={4}>
            <CloseButton onClick={close} />
          </Group>
        </Group>
        <Group gap={1} align="stretch">
          <Card w={180} p={0}>
            <ScrollArea mah={300} scrollbarSize={5}>
              <Stack gap={0} p="xs">
                {relativeTimeOptions.map((item, index) =>
                  item === 'divider' ? (
                    <Divider key={index} my={4} color="gray.9" />
                  ) : (
                    <Button
                      key={item[1]}
                      onClick={() => handleSearch(item[0])}
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
                data={['Time range', 'Around a time']}
                value="Time range"
                mb="xs"
                {...form.getInputProps('mode')}
              />
              {form.values.mode === 'Time range' ? (
                <>
                  <H>Start time</H>
                  <DateInputCmp
                    maxDate={today}
                    mb="xs"
                    {...form.getInputProps('startDate')}
                  />
                  <H>End time</H>
                  <DateInputCmp
                    maxDate={today}
                    minDate={form.values.startDate ?? undefined}
                    {...form.getInputProps('endDate')}
                  />
                </>
              ) : (
                <>
                  <H>Time</H>
                  <DateInputCmp
                    maxDate={today}
                    mb="xs"
                    {...form.getInputProps('startDate')}
                  />
                  <H>Duration ±</H>
                  <Select
                    placeholder="Pick value"
                    data={DURATION_OPTIONS}
                    searchable
                    size="xs"
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
                size="compact-sm"
                variant="light"
                disabled={!form.isValid()}
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
