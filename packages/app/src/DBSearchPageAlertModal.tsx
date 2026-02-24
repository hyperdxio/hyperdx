import React from 'react';
import router from 'next/router';
import { useForm, useWatch } from 'react-hook-form';
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
import { Alert as MantineAlert, TextInput } from '@mantine/core';
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
import {
  IconBrandSlack,
  IconChartLine,
  IconInfoCircleFilled,
  IconPlus,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { useCreateSavedSearch } from '@/savedSearch';
import { useSavedSearch } from '@/savedSearch';
import { useSource } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_INTERVAL_OPTIONS,
  ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

import { AlertPreviewChart } from './components/AlertPreviewChart';
import { AlertChannelForm } from './components/Alerts';
import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import { getWebhookChannelIcon } from './utils/webhookIcons';
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

  const { control, handleSubmit } = useForm<Alert>({
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

  const groupBy = useWatch({ control, name: 'groupBy' });
  const thresholdType = useWatch({ control, name: 'thresholdType' });
  const channelType = useWatch({ control, name: 'channel.type' });
  const interval = useWatch({ control, name: 'interval' });
  const groupByValue = useWatch({ control, name: 'groupBy' });
  const threshold = useWatch({ control, name: 'threshold' });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack gap="xs">
        <Paper px="md" py="sm" radius="xs">
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
        <Paper px="md" py="sm" radius="xs">
          <Text size="xxs" opacity={0.5} mb={4}>
            Send to
          </Text>
          <AlertChannelForm control={control} type={channelType} />
        </Paper>
        {groupBy && thresholdType === AlertThresholdType.BELOW && (
          <MantineAlert
            icon={<IconInfoCircleFilled size={16} />}
            bg="dark"
            py="xs"
          >
            <Text size="sm" opacity={0.7}>
              Warning: Alerts with a &quot;Below (&lt;)&quot; threshold and a
              &quot;grouped by&quot; value will not alert for periods with no
              data for a group.
            </Text>
          </MantineAlert>
        )}
      </Stack>

      <Accordion defaultValue={'chart'} mt="sm" mx={-16}>
        <Accordion.Item value="chart">
          <Accordion.Control icon={<IconChartLine size={16} />}>
            <Text size="sm">Threshold chart</Text>
          </Accordion.Control>
          <Accordion.Panel>
            {source && (
              <AlertPreviewChart
                source={source}
                where={where}
                whereLanguage={whereLanguage}
                select={select}
                interval={interval}
                groupBy={groupByValue}
                threshold={threshold}
                thresholdType={thresholdType}
              />
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {defaultValues?.createdBy && (
        <Paper px="md" py="sm" radius="xs" mt="sm">
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={loading}>
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
  const brandName = useBrandDisplayName();
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
          filters: searchedConfig.filters ?? [],
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
        message: `Something went wrong. Please contact ${brandName} team.`,
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
        message: `Something went wrong. Please contact ${brandName} team.`,
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
            <Text size="sm">
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
          <Text size="xxs">{savedSearch?.where}</Text>
        </Stack>

        <Tabs value={activeIndex} onChange={setTab} mb="xs">
          <Tabs.List>
            {(savedSearch?.alerts || []).map((alert, index) => (
              <Tabs.Tab key={alert.id} value={`${index}`}>
                <Group gap="xs">
                  {getWebhookChannelIcon(alert.channel.type)} Alert {index + 1}
                </Group>
              </Tabs.Tab>
            ))}
            <Tabs.Tab value="stage">
              <Group gap={4}>
                <IconPlus size={18} style={{ marginLeft: -8 }} />
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
