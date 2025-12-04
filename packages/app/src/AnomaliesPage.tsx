import * as React from 'react';
import Head from 'next/head';
import { formatRelative } from 'date-fns';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Drawer,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';

import { PageHeader } from '@/components/PageHeader';

import api from './api';
import { withAppNav } from './layout';
import type { Anomaly } from './types';

function AnomalyCard({
  anomaly,
  onClick,
}: {
  anomaly: Anomaly;
  onClick: () => void;
}) {
  const start = new Date(anomaly.startTime);
  const now = new Date();

  return (
    <Card
      onClick={onClick}
      withBorder
      mb="sm"
      style={{ cursor: 'pointer', '&:hover': { backgroundColor: '#f8f9fa' } }}
    >
      <Group justify="space-between">
        <Stack gap="xs">
          <Group>
            <Text fw={500} size="lg">
              {anomaly.serviceName}
            </Text>
            <Badge color={anomaly.status === 'open' ? 'red' : 'green'}>
              {anomaly.status.toUpperCase()}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {anomaly.metric} deviation: {anomaly.deviation.toFixed(1)}%
          </Text>
          <Text size="xs" c="dimmed">
            Detected {formatRelative(start, now)}
          </Text>
        </Stack>
        <Stack align="flex-end" gap="xs">
          <Text size="sm">
            Current: {anomaly.value.toFixed(2)}ms
          </Text>
          <Text size="sm" c="dimmed">
            Baseline: {anomaly.baseline.toFixed(2)}ms
          </Text>
        </Stack>
      </Group>
    </Card>
  );
}

function AnomalyDetails({
  anomaly,
  onClose,
}: {
  anomaly: Anomaly | null;
  onClose: () => void;
}) {
  const updateMutation = api.useUpdateAnomaly();

  if (!anomaly) return null;

  const handleResolve = () => {
    updateMutation.mutate(
      { id: anomaly._id, status: 'resolved' },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      opened={!!anomaly}
      onClose={onClose}
      title={<Title order={3}>Anomaly Details</Title>}
      position="right"
      size="xl"
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700} size="xl">
            {anomaly.serviceName}
          </Text>
          <Badge
            size="lg"
            color={anomaly.status === 'open' ? 'red' : 'green'}
          >
            {anomaly.status.toUpperCase()}
          </Badge>
        </Group>

        <Card withBorder>
          <Stack gap="xs">
            <Text fw={600}>Metrics</Text>
            <Group grow>
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Metric
                </Text>
                <Text>{anomaly.metric}</Text>
              </Stack>
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Deviation
                </Text>
                <Text color="red" fw={700}>
                  +{anomaly.deviation.toFixed(1)}%
                </Text>
              </Stack>
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Current Value
                </Text>
                <Text>{anomaly.value.toFixed(2)}ms</Text>
              </Stack>
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Baseline (24h)
                </Text>
                <Text>{anomaly.baseline.toFixed(2)}ms</Text>
              </Stack>
            </Group>
          </Stack>
        </Card>

        {anomaly.rcaAnalysis && (
          <Card withBorder style={{ backgroundColor: '#f0f9ff' }}>
            <Stack gap="sm">
              <Group>
                <i className="bi bi-robot" style={{ fontSize: '1.2rem' }} />
                <Text fw={600}>AI Root Cause Analysis</Text>
              </Group>
              <Text style={{ whiteSpace: 'pre-wrap' }}>
                {anomaly.rcaAnalysis}
              </Text>
            </Stack>
          </Card>
        )}

        {anomaly.status === 'open' && (
          <Button
            color="green"
            onClick={handleResolve}
            loading={updateMutation.isLoading}
            fullWidth
            mt="xl"
          >
            Mark as Resolved
          </Button>
        )}
      </Stack>
    </Drawer>
  );
}

export default function AnomaliesPage() {
  const [selectedAnomaly, setSelectedAnomaly] = React.useState<Anomaly | null>(
    null,
  );
  const { data, isLoading } = api.useAnomalies({ limit: 50 });

  const anomalies = data?.data || [];
  const openAnomalies = anomalies.filter((a) => a.status === 'open');
  const resolvedAnomalies = anomalies.filter((a) => a.status !== 'open');

  return (
    <div className="AnomaliesPage">
      <Head>
        <title>Anomalies - HyperDX</title>
      </Head>
      <PageHeader>Anomalies</PageHeader>
      <Container size="xl" my="md">
        {isLoading ? (
          <Text>Loading...</Text>
        ) : (
          <Stack gap="xl">
            <div>
              <Title order={4} mb="sm">
                Open Anomalies ({openAnomalies.length})
              </Title>
              {openAnomalies.length === 0 ? (
                <Text c="dimmed">No open anomalies detected.</Text>
              ) : (
                openAnomalies.map((anomaly) => (
                  <AnomalyCard
                    key={anomaly._id}
                    anomaly={anomaly}
                    onClick={() => setSelectedAnomaly(anomaly)}
                  />
                ))
              )}
            </div>

            {resolvedAnomalies.length > 0 && (
              <div>
                <Title order={4} mb="sm" c="dimmed">
                  Resolved / Ignored
                </Title>
                {resolvedAnomalies.map((anomaly) => (
                  <AnomalyCard
                    key={anomaly._id}
                    anomaly={anomaly}
                    onClick={() => setSelectedAnomaly(anomaly)}
                  />
                ))}
              </div>
            )}
          </Stack>
        )}
      </Container>

      <AnomalyDetails
        anomaly={selectedAnomaly}
        onClose={() => setSelectedAnomaly(null)}
      />
    </div>
  );
}

AnomaliesPage.getLayout = withAppNav;

