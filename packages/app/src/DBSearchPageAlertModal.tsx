import React from 'react';
import { useForm } from 'react-hook-form';
import { NativeSelect, NumberInput } from 'react-hook-form-mantine';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type Alert,
  AlertIntervalSchema,
  AlertSource,
  AlertThresholdType,
  zAlertChannel,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  Paper,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { useSavedSearch } from '@/savedSearch';
import { useSource } from '@/source';
import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_INTERVAL_OPTIONS,
  ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

import { AlertChannelForm } from './components/Alerts';
import api from './api';

const SavedSearchAlertFormSchema = z.object({
  interval: AlertIntervalSchema,
  threshold: z.number().int().min(1),
  thresholdType: z.nativeEnum(AlertThresholdType),
  channel: zAlertChannel,
});

const CHANNEL_ICONS = {
  webhook: <i className="bi bi-slack fs-7 text-slate-400" />,
};

const optionsToSelectData = (options: Record<string, string>) =>
  Object.entries(options).map(([value, label]) => ({ value, label }));

const AlertForm = ({
  sourceId,
  defaultValues,
  loading,
  deleteLoading,
  onDelete,
  onSubmit,
  onClose,
}: {
  sourceId?: string;
  defaultValues?: null | Alert;
  loading?: boolean;
  deleteLoading?: boolean;
  onDelete: (id: string) => void;
  onSubmit: (data: Alert) => void;
  onClose: () => void;
}) => {
  const { data: source } = useSource({ id: sourceId });

  const databaseName = source?.from.databaseName;
  const tableName = source?.from.tableName;
  const connectionId = source?.connection;

  const { control, handleSubmit, watch, formState } = useForm<Alert>({
    defaultValues: defaultValues || {
      interval: '5m',
      threshold: 1,
      thresholdType: AlertThresholdType.ABOVE,
      source: AlertSource.SAVED_SEARCH,
      channel: {
        type: 'webhook',
        webhookId: '',
      },
    },
    resolver: zodResolver(SavedSearchAlertFormSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack gap="xs">
        <Paper px="md" py="sm" bg="dark.6" radius="xs">
          <Text size="xxs" opacity={0.5}>
            Trigger
          </Text>
          <Group gap="xs">
            <Text size="sm" opacity={0.7}>
              Alert when
            </Text>
            <NativeSelect
              data={optionsToSelectData(ALERT_THRESHOLD_TYPE_OPTIONS)}
              size="xs"
              name={`thresholdType`}
              control={control}
            />
            <NumberInput
              min={1}
              size="xs"
              w={80}
              control={control}
              name={`threshold`}
            />
            <Text size="sm" opacity={0.7}>
              lines appear within
            </Text>
            <NativeSelect
              data={optionsToSelectData(ALERT_INTERVAL_OPTIONS)}
              size="xs"
              name={`interval`}
              control={control}
            />
            <Text size="sm" opacity={0.7}>
              via
            </Text>
            <NativeSelect
              data={optionsToSelectData(ALERT_CHANNEL_OPTIONS)}
              size="xs"
              name={`channel.type`}
              control={control}
            />
          </Group>
          <Text size="xxs" opacity={0.5} mb={4} mt="xs">
            grouped by
          </Text>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            connectionId={connectionId}
            name={`groupBy`}
            placeholder="SQL Columns"
            disableKeywordAutocomplete
            size="xs"
          />
        </Paper>
        <Paper px="md" py="sm" bg="dark.6" radius="xs">
          <Text size="xxs" opacity={0.5} mb={4}>
            Send to
          </Text>
          <AlertChannelForm control={control} type={watch('channel.type')} />
        </Paper>
      </Stack>
      <Group mt="lg" justify="space-between" gap="xs">
        <div>
          {defaultValues && (
            <Button
              variant="subtle"
              color="red"
              size="compact-sm"
              onClick={() => onDelete(defaultValues.id!)}
              loading={deleteLoading}
            >
              Delete Alert
            </Button>
          )}
        </div>
        <Group gap="xs">
          <Button variant="light" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="light" type="submit" loading={loading}>
            {defaultValues ? 'Save Alert' : 'Create Alert'}
          </Button>
        </Group>
      </Group>
    </form>
  );
};

export const DBSearchPageAlertModal = ({
  id,
  onClose,
  open,
}: {
  id: string;
  onClose: () => void;
  open: boolean;
}) => {
  const createAlert = api.useCreateAlert();
  const updateAlert = api.useUpdateAlert();
  const deleteAlert = api.useDeleteAlert();

  const { data: savedSearch, isLoading } = useSavedSearch({ id });

  const [activeIndex, setActiveIndex] = React.useState<'stage' | `${number}`>(
    'stage',
  );

  const setTab = (value: string | null) => {
    if (value === null) {
      return;
    } else if (value === 'stage') {
      setActiveIndex(value);
    } else {
      setActiveIndex(`${parseInt(value)}`);
    }
  };

  const onSubmit = async (data: Alert) => {
    try {
      // Create new alert
      if (activeIndex === 'stage') {
        await createAlert.mutate({
          ...data,
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: id,
        });
      } else if (data.id) {
        // Update existing alert
        await updateAlert.mutate({
          ...data,
          id: data.id,
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: id,
        });
      } else {
        return;
      }
      notifications.show({
        color: 'green',
        message: `Alert ${activeIndex === 'stage' ? 'created' : 'updated'}!`,
        autoClose: 5000,
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        message: 'Something went wrong. Please contact HyperDX team.',
        autoClose: 5000,
      });
    }
    onClose();
  };

  const onDelete = async (id: string) => {
    try {
      await deleteAlert.mutate(id);
      notifications.show({
        color: 'green',
        message: 'Alert deleted!',
        autoClose: 5000,
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        message: 'Something went wrong. Please contact HyperDX team.',
        autoClose: 5000,
      });
    }
    onClose();
  };

  return (
    <Modal opened={open} onClose={onClose} size="xl" withCloseButton={false}>
      <Box pos="relative">
        <LoadingOverlay
          visible={isLoading}
          m={-16}
          zIndex={1000}
          overlayProps={{
            radius: 'sm',
          }}
          loaderProps={{ type: 'dots' }}
        />
        <Stack gap={0} mb="md">
          <Text c="dark.1" size="sm">
            Alerts for <strong>{savedSearch?.name}</strong>
          </Text>
          <Text c="dark.2" size="xxs">
            {savedSearch?.where}
          </Text>
        </Stack>

        <Tabs value={activeIndex} onChange={setTab} mb="xs">
          <Tabs.List>
            {(savedSearch?.alerts || []).map((alert, index) => (
              <Tabs.Tab key={alert.id} value={`${index}`}>
                <Group gap="xs">
                  {CHANNEL_ICONS[alert.channel.type]} Alert {index + 1}
                </Group>
              </Tabs.Tab>
            ))}
            <Tabs.Tab value="stage">
              <Group gap={4}>
                <i
                  className="bi bi-plus fs-5 text-slate-400"
                  style={{ marginLeft: -8 }}
                />
                New Alert
              </Group>
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <AlertForm
          sourceId={savedSearch?.source}
          key={activeIndex}
          defaultValues={
            activeIndex === 'stage'
              ? null
              : savedSearch?.alerts?.[parseInt(activeIndex)]
          }
          onSubmit={onSubmit}
          onDelete={onDelete}
          deleteLoading={deleteAlert.isPending}
          onClose={onClose}
          loading={updateAlert.isPending || createAlert.isPending}
        />
      </Box>
    </Modal>
  );
};
