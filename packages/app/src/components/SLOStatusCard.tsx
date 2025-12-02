import React from 'react';
import { Card, Progress, Text, Badge, Group, Stack } from '@mantine/core';

export interface SLOStatusData {
  slo: {
    id: string;
    serviceName: string;
    sloName: string;
    metricType: string;
    targetValue: number;
  };
  achieved: number;
  target: number;
  errorBudgetRemaining: number;
  status: 'healthy' | 'at_risk' | 'breached';
  numerator: number;
  denominator: number;
  windowStart: string;
  windowEnd: string;
  timestamp: string;
}

interface SLOStatusCardProps {
  status: SLOStatusData;
  isLoading?: boolean;
}

export default function SLOStatusCard({
  status,
  isLoading = false,
}: SLOStatusCardProps) {
  if (isLoading) {
    return (
      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Text>Loading SLO status...</Text>
      </Card>
    );
  }

  const { slo, achieved, target, errorBudgetRemaining, status: sloStatus } =
    status;

  const getStatusColor = () => {
    switch (sloStatus) {
      case 'healthy':
        return 'green';
      case 'at_risk':
        return 'yellow';
      case 'breached':
        return 'red';
      default:
        return 'gray';
    }
  };

  const getStatusLabel = () => {
    switch (sloStatus) {
      case 'healthy':
        return 'Healthy';
      case 'at_risk':
        return 'At Risk';
      case 'breached':
        return 'Breached';
      default:
        return 'Unknown';
    }
  };

  const percentage = (achieved / target) * 100;

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="lg">
              {slo.sloName}
            </Text>
            <Text size="sm" c="dimmed">
              {slo.serviceName} • {slo.metricType}
            </Text>
          </div>
          <Badge color={getStatusColor()} size="lg">
            {getStatusLabel()}
          </Badge>
        </Group>

        <div>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={500}>
              Achieved: {achieved.toFixed(2)}%
            </Text>
            <Text size="sm" c="dimmed">
              Target: {target}%
            </Text>
          </Group>
          <Progress
            value={percentage > 100 ? 100 : percentage}
            color={getStatusColor()}
            size="lg"
            radius="xl"
          />
        </div>

        <div>
          <Text size="sm" fw={500} mb="xs">
            Error Budget Remaining
          </Text>
          <Progress
            value={errorBudgetRemaining}
            color={errorBudgetRemaining > 10 ? 'green' : 'red'}
            size="md"
            radius="xl"
          />
          <Text size="xs" c="dimmed" mt="xs">
            {errorBudgetRemaining.toFixed(2)}% remaining
          </Text>
        </div>

        <Group justify="space-between" mt="md">
          <Text size="xs" c="dimmed">
            Numerator: {status.numerator.toLocaleString()}
          </Text>
          <Text size="xs" c="dimmed">
            Denominator: {status.denominator.toLocaleString()}
          </Text>
        </Group>
      </Stack>
    </Card>
  );
}

