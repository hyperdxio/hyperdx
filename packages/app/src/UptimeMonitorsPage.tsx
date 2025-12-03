import * as React from 'react';
import Head from 'next/head';
import { formatRelative } from 'date-fns';
import {
  Badge,
  Button,
  Container,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  ActionIcon,
  NumberInput,
  Switch,
  MultiSelect,
  JsonInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconPencil, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/PageHeader';
import api from './api';

import styles from '../styles/AlertsPage.module.scss';

interface UptimeMonitor {
  _id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';
  interval: '1m' | '5m' | '10m' | '15m' | '30m' | '1h';
  timeout: number;
  status: 'UP' | 'DOWN' | 'PAUSED' | 'DEGRADED';
  team: string;
  createdBy?: {
    email: string;
    name: string;
  };
  notificationChannel?: {
    type: 'webhook' | null;
    webhookId?: string;
  };
  headers?: Record<string, string>;
  body?: string;
  expectedStatusCodes?: number[];
  expectedResponseTime?: number;
  expectedBodyContains?: string;
  verifySsl?: boolean;
  lastCheckedAt?: string;
  lastStatus?: 'UP' | 'DOWN' | 'PAUSED' | 'DEGRADED';
  lastResponseTime?: number;
  lastError?: string;
  paused?: boolean;
  pausedBy?: string;
  pausedAt?: string;
  pausedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

function UptimeMonitorForm({
  monitor,
  onClose,
  onSuccess,
}: {
  monitor?: UptimeMonitor;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const createMonitor = api.useCreateUptimeMonitor();
  const updateMonitor = api.useUpdateUptimeMonitor();
  const { data: webhooksData } = api.useWebhooks(['slack', 'generic']);

  const form = useForm({
    initialValues: {
      name: monitor?.name || '',
      url: monitor?.url || '',
      method: monitor?.method || 'GET',
      interval: monitor?.interval || '5m',
      timeout: monitor?.timeout || 10000,
      notificationChannelType: monitor?.notificationChannel?.type || null,
      notificationChannelWebhookId: monitor?.notificationChannel?.webhookId || '',
      headers: monitor?.headers ? JSON.stringify(monitor.headers, null, 2) : '',
      body: monitor?.body || '',
      expectedStatusCodes: monitor?.expectedStatusCodes?.map(String) || ['200'],
      expectedResponseTime: monitor?.expectedResponseTime || undefined,
      expectedBodyContains: monitor?.expectedBodyContains || '',
      verifySsl: monitor?.verifySsl ?? true,
    },
    validate: {
      name: value => (!value ? 'Name is required' : null),
      url: value => {
        if (!value) return 'URL is required';
        try {
          new URL(value);
          return null;
        } catch {
          return 'Invalid URL';
        }
      },
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const payload: any = {
        name: values.name,
        url: values.url,
        method: values.method,
        interval: values.interval,
        timeout: values.timeout,
        notificationChannel:
          values.notificationChannelType === 'webhook'
            ? {
                type: 'webhook',
                webhookId: values.notificationChannelWebhookId,
              }
            : { type: null },
        headers: values.headers ? JSON.parse(values.headers) : undefined,
        body: values.body || undefined,
        expectedStatusCodes: values.expectedStatusCodes.map(Number),
        expectedResponseTime: values.expectedResponseTime || undefined,
        expectedBodyContains: values.expectedBodyContains || undefined,
        verifySsl: values.verifySsl,
      };

      if (monitor) {
        await updateMonitor.mutateAsync({ id: monitor._id, ...payload });
        notifications.show({
          title: 'Success',
          message: 'Uptime monitor updated successfully',
          color: 'green',
        });
      } else {
        await createMonitor.mutateAsync(payload);
        notifications.show({
          title: 'Success',
          message: 'Uptime monitor created successfully',
          color: 'green',
        });
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to save uptime monitor',
        color: 'red',
      });
    }
  };

  const webhookOptions =
    webhooksData?.data?.map((webhook: any) => ({
      value: webhook._id,
      label: webhook.name,
    })) || [];

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="md">
        <TextInput
          label="Monitor Name"
          placeholder="My API Endpoint"
          required
          {...form.getInputProps('name')}
        />
        <TextInput
          label="URL"
          placeholder="https://example.com/api/health"
          required
          {...form.getInputProps('url')}
        />
        <Group grow>
          <Select
            label="HTTP Method"
            data={[
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
              { value: 'PUT', label: 'PUT' },
              { value: 'DELETE', label: 'DELETE' },
              { value: 'HEAD', label: 'HEAD' },
              { value: 'OPTIONS', label: 'OPTIONS' },
            ]}
            {...form.getInputProps('method')}
          />
          <Select
            label="Check Interval"
            data={[
              { value: '1m', label: 'Every 1 minute' },
              { value: '5m', label: 'Every 5 minutes' },
              { value: '10m', label: 'Every 10 minutes' },
              { value: '15m', label: 'Every 15 minutes' },
              { value: '30m', label: 'Every 30 minutes' },
              { value: '1h', label: 'Every 1 hour' },
            ]}
            {...form.getInputProps('interval')}
          />
        </Group>
        <NumberInput
          label="Timeout (ms)"
          placeholder="10000"
          min={1000}
          max={60000}
          {...form.getInputProps('timeout')}
        />
        <MultiSelect
          label="Expected Status Codes"
          placeholder="200"
          data={[
            '200',
            '201',
            '202',
            '204',
            '301',
            '302',
            '304',
            '400',
            '401',
            '403',
            '404',
            '500',
          ]}
          {...form.getInputProps('expectedStatusCodes')}
        />
        <NumberInput
          label="Expected Response Time (ms)"
          placeholder="Optional - alert if response time exceeds this"
          min={0}
          {...form.getInputProps('expectedResponseTime')}
        />
        <TextInput
          label="Expected Body Contains"
          placeholder="Optional - check if response body contains this string"
          {...form.getInputProps('expectedBodyContains')}
        />
        <Switch
          label="Verify SSL Certificate"
          {...form.getInputProps('verifySsl', { type: 'checkbox' })}
        />
        <Textarea
          label="Request Headers (JSON)"
          placeholder='{"Authorization": "Bearer token"}'
          minRows={3}
          {...form.getInputProps('headers')}
        />
        <Textarea
          label="Request Body"
          placeholder="Optional request body"
          minRows={3}
          {...form.getInputProps('body')}
        />
        <Select
          label="Notification Channel"
          placeholder="Select a webhook"
          data={[
            { value: 'null', label: 'None' },
            ...webhookOptions,
          ]}
          value={
            form.values.notificationChannelType === 'webhook'
              ? form.values.notificationChannelWebhookId
              : 'null'
          }
          onChange={value => {
            if (value === 'null') {
              form.setFieldValue('notificationChannelType', null);
              form.setFieldValue('notificationChannelWebhookId', '');
            } else {
              form.setFieldValue('notificationChannelType', 'webhook');
              form.setFieldValue('notificationChannelWebhookId', value || '');
            }
          }}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={createMonitor.isPending || updateMonitor.isPending}
          >
            {monitor ? 'Update' : 'Create'} Monitor
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function UptimeMonitorRow({ monitor }: { monitor: UptimeMonitor }) {
  const queryClient = useQueryClient();
  const deleteMonitor = api.useDeleteUptimeMonitor();
  const pauseMonitor = api.usePauseUptimeMonitor();
  const resumeMonitor = api.useResumeUptimeMonitor();
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this monitor?')) return;

    try {
      await deleteMonitor.mutateAsync(monitor._id);
      queryClient.invalidateQueries({ queryKey: ['uptime-monitors'] });
      notifications.show({
        title: 'Success',
        message: 'Monitor deleted successfully',
        color: 'green',
      });
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to delete monitor',
        color: 'red',
      });
    }
  };

  const handlePause = async () => {
    try {
      await pauseMonitor.mutateAsync({ id: monitor._id });
      queryClient.invalidateQueries({ queryKey: ['uptime-monitors'] });
      notifications.show({
        title: 'Success',
        message: 'Monitor paused successfully',
        color: 'green',
      });
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to pause monitor',
        color: 'red',
      });
    }
  };

  const handleResume = async () => {
    try {
      await resumeMonitor.mutateAsync(monitor._id);
      queryClient.invalidateQueries({ queryKey: ['uptime-monitors'] });
      notifications.show({
        title: 'Success',
        message: 'Monitor resumed successfully',
        color: 'green',
      });
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to resume monitor',
        color: 'red',
      });
    }
  };

  const statusColor = {
    UP: 'green',
    DOWN: 'red',
    DEGRADED: 'yellow',
    PAUSED: 'gray',
  }[monitor.status];

  const lastChecked = monitor.lastCheckedAt
    ? formatRelative(new Date(monitor.lastCheckedAt), new Date())
    : 'Never';

  return (
    <>
      <Table.Tr>
        <Table.Td>
          <div>
            <Text fw={500}>{monitor.name}</Text>
            <Text size="sm" c="dimmed">
              {monitor.url}
            </Text>
          </div>
        </Table.Td>
        <Table.Td>
          <Badge color={statusColor}>{monitor.status}</Badge>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{monitor.method}</Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{monitor.interval}</Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{lastChecked}</Text>
        </Table.Td>
        <Table.Td>
          {monitor.lastResponseTime ? (
            <Text size="sm">{monitor.lastResponseTime}ms</Text>
          ) : (
            <Text size="sm" c="dimmed">
              -
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          {monitor.lastError ? (
            <Tooltip label={monitor.lastError}>
              <Text size="sm" c="red" lineClamp={1}>
                {monitor.lastError}
              </Text>
            </Tooltip>
          ) : (
            <Text size="sm" c="dimmed">
              -
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              color="blue"
              onClick={openEdit}
              title="Edit"
            >
              <IconPencil size={16} />
            </ActionIcon>
            {monitor.paused ? (
              <ActionIcon
                variant="subtle"
                color="green"
                onClick={handleResume}
                title="Resume"
                loading={resumeMonitor.isPending}
              >
                <IconPlayerPlay size={16} />
              </ActionIcon>
            ) : (
              <ActionIcon
                variant="subtle"
                color="orange"
                onClick={handlePause}
                title="Pause"
                loading={pauseMonitor.isPending}
              >
                <IconPlayerPause size={16} />
              </ActionIcon>
            )}
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={handleDelete}
              title="Delete"
              loading={deleteMonitor.isPending}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Table.Td>
      </Table.Tr>
      <Modal
        opened={editOpened}
        onClose={closeEdit}
        title="Edit Uptime Monitor"
        size="lg"
      >
        <UptimeMonitorForm
          monitor={monitor}
          onClose={closeEdit}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['uptime-monitors'] });
          }}
        />
      </Modal>
    </>
  );
}

export default function UptimeMonitorsPage() {
  const { data: monitorsData, isLoading } = api.useUptimeMonitors();
  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const queryClient = useQueryClient();

  const monitors: UptimeMonitor[] = monitorsData?.data || [];

  return (
    <>
      <Head>
        <title>Uptime Monitors - HyperDX</title>
      </Head>
      <div className="UptimeMonitorsPage">
        <PageHeader>Uptime Monitors</PageHeader>
        <Container size="xl" py="md">
          <Group justify="space-between" mb="md">
            <Text size="sm" c="dimmed">
              {monitors.length} monitor{monitors.length !== 1 ? 's' : ''}
            </Text>
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              Create Monitor
            </Button>
          </Group>

          {isLoading ? (
            <Text>Loading...</Text>
          ) : monitors.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              No uptime monitors yet. Create one to get started!
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name / URL</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Method</Table.Th>
                  <Table.Th>Interval</Table.Th>
                  <Table.Th>Last Checked</Table.Th>
                  <Table.Th>Response Time</Table.Th>
                  <Table.Th>Last Error</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {monitors.map(monitor => (
                  <UptimeMonitorRow key={monitor._id} monitor={monitor} />
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Container>
      </div>

      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Uptime Monitor"
        size="lg"
      >
        <UptimeMonitorForm
          onClose={closeCreate}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['uptime-monitors'] });
          }}
        />
      </Modal>
    </>
  );
}

