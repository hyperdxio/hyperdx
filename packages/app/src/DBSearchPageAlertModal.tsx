import React from 'react';
import router from 'next/router';
import { useForm } from 'react-hook-form';
import { NativeSelect, NumberInput } from 'react-hook-form-mantine';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  type Alert,
  AlertIntervalSchema,
  AlertSource,
  AlertThresholdType,
  SearchCondition,
  SearchConditionLanguage,
  zAlertChannel,
} from '@hyperdx/common-utils/dist/types';
import { TextInput } from '@mantine/core';
import {
  Accordion,
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
import { useQueryClient } from '@tanstack/react-query';

import { useCreateSavedSearch } from '@/savedSearch';
import { useSavedSearch } from '@/savedSearch';
import { useSource } from '@/source';
import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_INTERVAL_OPTIONS,
  ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

import { AlertPreviewChart } from './components/AlertPreviewChart';
import { AlertChannelForm } from './components/Alerts';
import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import api from './api';
import { AlertWithCreatedBy, SearchConfig } from './types';
import { optionsToSelectData } from './utils';

const SavedSearchAlertFormSchema = z
  .object({
    interval: AlertIntervalSchema,
    threshold: z.number().int().min(1),
    thresholdType: z.nativeEnum(AlertThresholdType),
    channel: zAlertChannel,
  })
  .passthrough();

const CHANNEL_ICONS = {
  webhook: <i className="bi bi-slack fs-7 text-slate-400" />,
};

const AlertForm = ({
  sourceId,
  where,
  whereLanguage,
  select,
  defaultValues,
  loading,
  deleteLoading,
  hasSavedSearch,
  onDelete,
  onSubmit,
  onClose,
}: {
  sourceId?: string | null;
  where?: SearchCondition | null;
  whereLanguage?: SearchConditionLanguage | null;
  select?: string | null;
  defaultValues?: null | AlertWithCreatedBy;
  loading?: boolean;
  deleteLoading?: boolean;
  hasSavedSearch?: boolean;
  onDelete: (id: string) => void;
  onSubmit: (data: Alert) => void;
  onClose: () => void;
}) => {
  const { data: source } = useSource({ id: sourceId });

  const { control, handleSubmit, watch } = useForm<Alert>({
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
            tableConnection={tcFromSource(source)}
            control={control}
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

      <Accordion defaultValue={'chart'} mt="sm" mx={-16}>
        <Accordion.Item value="chart">
          <Accordion.Control icon={<i className="bi bi-chart"></i>}>
            <Text size="sm">Threshold chart</Text>
          </Accordion.Control>
          <Accordion.Panel>
            {source && (
              <AlertPreviewChart
                source={source}
                where={where}
                whereLanguage={whereLanguage}
                select={select}
                interval={watch('interval')}
                groupBy={watch('groupBy')}
                threshold={watch('threshold')}
                thresholdType={watch('thresholdType')}
              />
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {defaultValues?.createdBy && (
        <Paper px="md" py="sm" bg="dark.6" radius="xs" mt="sm">
          <Text size="xxs" opacity={0.5} mb={4}>
            Created by
          </Text>
          <Text size="sm" opacity={0.8}>
            {defaultValues.createdBy.name || defaultValues.createdBy.email}
          </Text>
          {defaultValues.createdBy.name && (
            <Text size="xs" opacity={0.6}>
              {defaultValues.createdBy.email}
            </Text>
          )}
        </Paper>
      )}

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
            {defaultValues
              ? 'Save Alert'
              : hasSavedSearch
                ? 'Create Alert'
                : 'Save Search with Alert'}
          </Button>
        </Group>
      </Group>
    </form>
  );
};

export const DBSearchPageAlertModal = ({
  id,
  searchedConfig,
  onClose,
  open,
}: {
  id?: string;
  searchedConfig?: SearchConfig;
  onClose: () => void;
  open: boolean;
}) => {
  const queryClient = useQueryClient();
  const createAlert = api.useCreateAlert();
  const updateAlert = api.useUpdateAlert();
  const deleteAlert = api.useDeleteAlert();
  const createSavedSearch = useCreateSavedSearch();

  const { data: savedSearch, isLoading } = useSavedSearch(
    { id: id || '' },
    { enabled: !!id },
  );

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

  const [name, setName] = React.useState<string>('');

  const onSubmit = async (data: Alert) => {
    try {
      // Create new search along with alert
      if (!id && searchedConfig) {
        if (!name) {
          notifications.show({
            color: 'red',
            message: 'Please provide a name for the saved search.',
            autoClose: 5000,
          });
          return;
        }
        const result = await createSavedSearch.mutateAsync({
          name,
          select: searchedConfig.select ?? '',
          where: searchedConfig.where ?? '',
          whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
          source: searchedConfig.source ?? '',
          orderBy: searchedConfig.orderBy ?? '',
          tags: [],
        });
        await createAlert.mutate({
          ...data,
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: result.id,
        });
        router.push(`/search/${result.id}`);
        onClose();
      } else if (id) {
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
      }
    } catch (error) {
      notifications.show({
        color: 'red',
        message: 'Something went wrong. Please contact HyperDX team.',
        autoClose: 5000,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['saved-search'] });
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
    queryClient.invalidateQueries({ queryKey: ['saved-search'] });
    onClose();
  };

  return (
    <Modal
      data-testid="alerts-modal"
      opened={open}
      onClose={onClose}
      size="xl"
      withCloseButton={false}
      zIndex={9999}
    >
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
          <Group>
            <Text c="dark.1" size="sm">
              Alerts for <strong>{savedSearch?.name}</strong>
            </Text>
            {!id && (
              <TextInput
                size="xs"
                placeholder="Saved search name"
                value={name}
                onChange={e => setName(e.currentTarget.value)}
                required
              />
            )}
          </Group>
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
          key={activeIndex}
          hasSavedSearch={!!savedSearch}
          sourceId={searchedConfig?.source}
          where={searchedConfig?.where}
          whereLanguage={searchedConfig?.whereLanguage}
          select={searchedConfig?.select}
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
