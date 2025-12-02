import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
  Select,
  NumberInput,
  Textarea,
  SegmentedControl,
  Divider,
  LoadingOverlay,
} from '@mantine/core';
import { useForm } from 'react-hook-form';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import api from './api';
import { withAppNav } from './layout';
import SLOStatusCard from './components/SLOStatusCard';
import SLOBuilder from './components/SLOBuilder';

function SLOCreationModal({
  opened,
  onClose,
  onSuccess,
}: {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const createSLO = api.useCreateSLO();
  const [metricType, setMetricType] = useState<string | null>('availability');
  const [mode, setMode] = useState<string>('builder');
  const [sourceTable, setSourceTable] = useState<string>('otel_logs');
  const [generatedFilter, setGeneratedFilter] = useState('');
  const [generatedGoodCondition, setGeneratedGoodCondition] = useState('');

  const { register, handleSubmit, reset, setValue } = useForm();

  const handleBuilderGenerate = (filter: string, goodCondition: string) => {
    setGeneratedFilter(filter);
    setGeneratedGoodCondition(goodCondition);
    setValue('filter', filter);
    setValue('goodCondition', goodCondition);
    notifications.show({
      color: 'green',
      message: 'SLO conditions generated! Review and create your SLO.',
    });
  };

  const onSubmit = (data: any) => {
    // If builder mode, clear raw queries (or let backend handle precedence)
    const payload = {
      ...data,
      metricType,
      sourceTable,
      targetValue: parseFloat(data.targetValue),
      alertThreshold: data.alertThreshold
        ? parseFloat(data.alertThreshold)
        : undefined,
    };

    if (mode === 'builder') {
      delete payload.numeratorQuery;
      delete payload.denominatorQuery;
    } else {
      delete payload.filter;
      delete payload.goodCondition;
    }

    createSLO.mutate(payload, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message: 'SLO created successfully',
        });
        onSuccess();
        onClose();
        reset();
      },
      onError: (err: any) => {
        notifications.show({
          color: 'red',
          message: err.message || 'Failed to create SLO',
        });
      },
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Create New SLO"
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Service Name"
            placeholder="e.g. api-service"
            required
            {...register('serviceName', { required: true })}
          />
          <TextInput
            label="SLO Name"
            placeholder="e.g. availability-99.9"
            required
            {...register('sloName', { required: true })}
          />
          <Select
            label="Metric Type"
            data={[
              { value: 'availability', label: 'Availability' },
              { value: 'latency', label: 'Latency' },
              { value: 'error_rate', label: 'Error Rate' },
            ]}
            value={metricType}
            onChange={setMetricType}
            required
          />
          <TextInput
            label="Target Value (%)"
            placeholder="99.9"
            type="number"
            step="0.01"
            required
            {...register('targetValue', { required: true })}
          />
          <TextInput
            label="Time Window"
            placeholder="30d"
            defaultValue="30d"
            required
            {...register('timeWindow', { required: true })}
          />
          <Select
            label="Data Source"
            description="Choose whether to measure SLO against logs or traces"
            data={[
              { value: 'otel_logs', label: 'Logs (for error rates, log-based availability)' },
              { value: 'otel_traces', label: 'Traces (for request latency, span-based availability)' },
            ]}
            value={sourceTable}
            onChange={(value) => setSourceTable(value || 'otel_logs')}
            required
          />

          <Divider label="SLI Definition" labelPosition="center" />
          
          <SegmentedControl
            value={mode}
            onChange={setMode}
            data={[
              { label: 'Builder (Recommended)', value: 'builder' },
              { label: 'Raw SQL', value: 'sql' },
            ]}
          />

          {mode === 'builder' ? (
            <>
              <SLOBuilder
                metricType={metricType || 'availability'}
                sourceTable={sourceTable}
                onGenerate={handleBuilderGenerate}
              />
              
              {generatedFilter && generatedGoodCondition && (
                <Alert color="green" variant="light" title="Ready to Create">
                  <Stack gap="xs">
                    <Text size="sm">
                      Your SLO conditions have been generated. Review the settings below and click "Create SLO".
                    </Text>
                    <Group gap="xs">
                      <Badge>Filter: {generatedFilter.substring(0, 50)}{generatedFilter.length > 50 ? '...' : ''}</Badge>
                      <Badge>Condition: {generatedGoodCondition.substring(0, 50)}{generatedGoodCondition.length > 50 ? '...' : ''}</Badge>
                    </Group>
                  </Stack>
                </Alert>
              )}
              
              {/* Hidden fields to store generated values */}
              <input type="hidden" {...register('filter')} />
              <input type="hidden" {...register('goodCondition')} />
            </>
          ) : (
            <>
              <Textarea
                label="Numerator Query"
                description="ClickHouse query returning 'count' column for successful events"
                placeholder={`SELECT count() as count FROM default.${sourceTable} WHERE ...`}
                required={mode === 'sql'}
                minRows={3}
                {...register('numeratorQuery', { required: mode === 'sql' })}
              />
              <Textarea
                label="Denominator Query"
                description="ClickHouse query returning 'count' column for total events"
                placeholder={`SELECT count() as count FROM default.${sourceTable} WHERE ...`}
                required={mode === 'sql'}
                minRows={3}
                {...register('denominatorQuery', { required: mode === 'sql' })}
              />
            </>
          )}

          <TextInput
            label="Alert Threshold (% Error Budget Remaining)"
            placeholder="10"
            type="number"
            {...register('alertThreshold')}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={createSLO.isPending}>
              Create SLO
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function SLOPage() {
  const { data: slos, isLoading, refetch } = api.useSLOs();
  const [isCreationModalOpen, setIsCreationModalOpen] = useState(false);

  return (
    <Container fluid p="md">
      <Head>
        <title>SLOs - HyperDX</title>
      </Head>

      <Group justify="space-between" mb="lg">
        <Title order={2}>Service Level Objectives</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setIsCreationModalOpen(true)}
        >
          Create SLO
        </Button>
      </Group>

      <Box pos="relative">
        <LoadingOverlay visible={isLoading} />
        {slos?.length === 0 && !isLoading ? (
          <Text c="dimmed" ta="center" py="xl">
            No SLOs found. Create one to get started.
          </Text>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
              gap: '1rem',
            }}
          >
            {slos?.map((slo: any) => (
              <Link
                key={slo.id}
                href={`/slos/${slo.id}`}
                style={{ textDecoration: 'none' }}
              >
                <SLOListItem slo={slo} />
              </Link>
            ))}
          </div>
        )}
      </Box>

      <SLOCreationModal
        opened={isCreationModalOpen}
        onClose={() => setIsCreationModalOpen(false)}
        onSuccess={refetch}
      />
    </Container>
  );
}

function SLOListItem({ slo }: { slo: any }) {
  // Fetch status for this SLO
  const { data: status } = api.useSLOStatus(slo.id);

  if (!status) {
    return (
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600} size="lg">
              {slo.sloName}
            </Text>
            <Badge color="gray">Loading...</Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {slo.serviceName}
          </Text>
        </Stack>
      </Card>
    );
  }

  return <SLOStatusCard status={status} />;
}

export default SLOPage;

