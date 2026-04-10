import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import {
  ActionIcon,
  Box,
  Collapse,
  Group,
  NativeSelect,
  NumberInput,
  Paper,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconTrash } from '@tabler/icons-react';

import { AlertChannelForm } from '@/components/Alerts';
import { AlertScheduleFields } from '@/components/AlertScheduleFields';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { optionsToSelectData } from '@/utils';
import {
  ALERT_CHANNEL_OPTIONS,
  intervalToMinutes,
  TILE_ALERT_INTERVAL_OPTIONS,
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

export function TileAlertEditor({
  control,
  setValue,
  alert,
  onRemove,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  alert: NonNullable<ChartEditorFormState['alert']>;
  onRemove: () => void;
}) {
  const [opened, { toggle }] = useDisclosure(true);

  const alertChannelType = useWatch({ control, name: 'alert.channel.type' });
  const alertScheduleOffsetMinutes = useWatch({
    control,
    name: 'alert.scheduleOffsetMinutes',
  });
  const maxAlertScheduleOffsetMinutes = alert?.interval
    ? Math.max(intervalToMinutes(alert.interval) - 1, 0)
    : 0;
  const alertIntervalLabel = alert?.interval
    ? TILE_ALERT_INTERVAL_OPTIONS[alert.interval]
    : undefined;

  return (
    <Paper data-testid="alert-details">
      <Group justify="space-between" px="sm" pt="sm" pb={opened ? 0 : 'sm'}>
        <UnstyledButton onClick={toggle}>
          <Group gap="xs">
            <IconChevronDown
              size={14}
              style={{
                transform: opened ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 200ms',
              }}
            />
            <Text size="sm" fw={500}>
              Alert
            </Text>
          </Group>
        </UnstyledButton>
        <Tooltip label="Remove alert">
          <ActionIcon
            variant="danger"
            color="red"
            size="sm"
            onClick={onRemove}
            data-testid="remove-alert-button"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Collapse expanded={opened}>
        <Box px="sm" pb="sm">
          <Group gap="xs">
            <Text size="sm" opacity={0.7}>
              Trigger when the value
            </Text>
            <Controller
              control={control}
              name="alert.thresholdType"
              render={({ field }) => (
                <NativeSelect
                  data={optionsToSelectData(TILE_ALERT_THRESHOLD_TYPE_OPTIONS)}
                  size="xs"
                  {...field}
                />
              )}
            />
            <Controller
              control={control}
              name="alert.threshold"
              render={({ field }) => (
                <NumberInput size="xs" w={80} {...field} />
              )}
            />
            over
            <Controller
              control={control}
              name="alert.interval"
              render={({ field }) => (
                <NativeSelect
                  data={optionsToSelectData(TILE_ALERT_INTERVAL_OPTIONS)}
                  size="xs"
                  {...field}
                />
              )}
            />
            <Text size="sm" opacity={0.7}>
              window via
            </Text>
            <Controller
              control={control}
              name="alert.channel.type"
              render={({ field }) => (
                <NativeSelect
                  data={optionsToSelectData(ALERT_CHANNEL_OPTIONS)}
                  size="xs"
                  {...field}
                />
              )}
            />
          </Group>
          {alert?.createdBy && (
            <Text size="xs" opacity={0.6} mt="xs">
              Created by {alert.createdBy.name || alert.createdBy.email}
            </Text>
          )}
          <AlertScheduleFields
            control={control}
            setValue={setValue}
            scheduleOffsetName="alert.scheduleOffsetMinutes"
            scheduleStartAtName="alert.scheduleStartAt"
            scheduleOffsetMinutes={alertScheduleOffsetMinutes}
            maxScheduleOffsetMinutes={maxAlertScheduleOffsetMinutes}
            offsetWindowLabel={
              alertIntervalLabel
                ? `from each ${alertIntervalLabel} window`
                : 'from each alert window'
            }
          />
          <Text size="xxs" opacity={0.5} mb={4} mt="sm">
            Send to
          </Text>
          <AlertChannelForm
            control={control}
            type={alertChannelType}
            namePrefix="alert."
          />
        </Box>
      </Collapse>
    </Paper>
  );
}
