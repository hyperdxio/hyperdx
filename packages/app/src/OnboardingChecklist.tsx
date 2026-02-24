import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { differenceInDays } from 'date-fns';
import {
  ActionIcon,
  Badge,
  Card,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';

import { useQueriedChartConfig } from './hooks/useChartConfig';
import api from './api';
import { useConnections } from './connection';
import { useSources } from './source';
import { useLocalStorage } from './utils';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  isComplete: boolean;
  isLoading?: boolean;
  href?: string;
  onClick?: () => void;
}

const NOW = Date.now();
const OnboardingChecklist = ({
  onAddDataClick,
}: {
  onAddDataClick?: () => void;
}) => {
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    'onboardingChecklistCollapsed',
    false,
  );

  const { data: team, isLoading: isTeamLoading } = api.useTeam();
  const { data: connections, isLoading: isConnectionsLoading } =
    useConnections();
  const { data: sources, isLoading: isSourcesLoading } = useSources();

  // Check if team is new (less than 3 days old)
  const isNewTeam = useMemo(() => {
    if (!team?.createdAt) return false;
    const threeDaysAgo = new Date(NOW - 1000 * 60 * 60 * 24 * 3);
    return new Date(team.createdAt) > threeDaysAgo;
  }, [team]);

  const shouldShow = useMemo(
    () => isTeamLoading === false && isNewTeam,
    [isTeamLoading, isNewTeam],
  );

  const firstConnection = useMemo(() => connections?.[0], [connections]);
  const firstConnectionSources = useMemo(
    () => sources?.filter(source => source.connection === firstConnection?.id),
    [sources, firstConnection],
  );

  const sourceRowsConfig = useMemo(
    () => ({
      select: 'sum(total_rows) as total_rows',
      from: {
        databaseName: 'system',
        tableName: 'tables',
      },
      where: '',
      filtersLogicalOperator: 'OR' as const,
      filters: (firstConnectionSources ?? []).map(source => ({
        type: 'sql' as const,
        condition: `table = '${source.from.tableName}' AND database = '${source.from.databaseName}'`,
      })),
      connection: firstConnection?.id ?? '',
    }),
    [firstConnectionSources, firstConnection],
  );
  const { data: sourceRowsData, isLoading: isSourceRowsLoading } =
    useQueriedChartConfig(sourceRowsConfig, {
      enabled: shouldShow,
    });
  const hasData = sourceRowsData?.data?.[0]?.total_rows > 0;
  // const hasData = false;

  // Check if connections exist
  const hasConnections = useMemo(() => {
    return connections && connections.length > 0;
  }, [connections]);
  // const hasConnections = false;
  // const hasSources = false;

  // Check if sources exist
  const hasSources = useMemo(() => {
    return sources && sources.length > 0;
  }, [sources]);

  const steps: OnboardingStep[] = useMemo(
    () => [
      {
        id: 'connection',
        title: 'Connect to ClickHouse',
        description: 'Set up your database connection',
        isComplete: hasConnections ?? false,
        isLoading: isConnectionsLoading,
        href: hasConnections ? undefined : '/team',
      },
      {
        id: 'sources',
        title: 'Create Data Sources',
        description: 'Configure where your data comes from',
        isComplete: hasSources ?? false,
        isLoading: isSourcesLoading,
        href: hasSources ? undefined : '/team',
      },
      {
        id: 'data',
        title: 'Add Data',
        description: 'Start sending logs, metrics, or traces',
        isComplete: hasData,
        isLoading: isSourceRowsLoading, // We'll implement data checking later
        onClick: hasData ? undefined : onAddDataClick,
      },
    ],
    [
      hasConnections,
      hasSources,
      hasData,
      isConnectionsLoading,
      isSourcesLoading,
      onAddDataClick,
      isSourceRowsLoading,
    ],
  );

  const completedSteps = steps.filter(step => step.isComplete).length;
  const isAllComplete = completedSteps === steps.length;

  // Don't show if team is not new or still loading
  if (!shouldShow) {
    return null;
  }

  return (
    <Card withBorder p="xs" mb="sm" radius="md">
      <Group justify="space-between" align="center" mb={isCollapsed ? 0 : 'xs'}>
        <Group gap="xs" align="center">
          <Text size="sm" fw="bold">
            Get Started
          </Text>
          <Badge
            size="xs"
            color={isAllComplete ? 'green' : 'blue'}
            variant="light"
          >
            {completedSteps}/{steps.length}
          </Badge>
        </Group>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <IconChevronDown size={12} />
          ) : (
            <IconChevronUp size={12} />
          )}
        </ActionIcon>
      </Group>

      <Collapse in={!isCollapsed}>
        <Stack gap="xs">
          {steps.map((step, index) => {
            const StepContent = (
              <Group gap="sm" align="center" w="100%">
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: step.isComplete
                      ? '1px solid var(--color-text-brand)'
                      : '1px solid var(--color-border)',
                    backgroundColor: step.isComplete
                      ? 'transparent'
                      : 'var(--color-bg-muted)',
                    color: step.isComplete
                      ? 'var(--color-text-brand)'
                      : 'var(--color-text)',
                    flexShrink: 0,
                  }}
                >
                  {step.isLoading ? (
                    <Loader size="xs" color="gray" />
                  ) : step.isComplete ? (
                    <IconCheck
                      size={16}
                      style={{
                        fontSize: 12,
                        fontWeight: 'bold',
                        paddingTop: 1,
                      }}
                    />
                  ) : (
                    <Text size="xs" fw="bold">
                      {index + 1}
                    </Text>
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <Text
                    size="sm"
                    fw="500"
                    style={{
                      textDecoration: step.isComplete ? 'line-through' : 'none',
                      opacity: step.isComplete ? 0.8 : 1,
                    }}
                  >
                    {step.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {step.description}
                  </Text>
                </div>

                {!step.isComplete && (step.href || step.onClick) && (
                  <IconArrowRight
                    size={12}
                    style={{
                      color: 'var(--color-text-muted)',
                    }}
                  />
                )}
              </Group>
            );

            if (step.href && !step.isComplete) {
              return (
                <Link
                  key={step.id}
                  href={step.href}
                  style={{ textDecoration: 'none' }}
                >
                  <UnstyledButton
                    w="100%"
                    py="xs"
                    style={{
                      borderRadius: 6,
                      cursor: 'pointer',
                      ':hover': {
                        backgroundColor: 'var(--color-bg-muted)',
                      },
                    }}
                  >
                    {StepContent}
                  </UnstyledButton>
                </Link>
              );
            }

            if (step.onClick && !step.isComplete) {
              return (
                <UnstyledButton
                  key={step.id}
                  w="100%"
                  py="xs"
                  onClick={step.onClick}
                  style={{
                    borderRadius: 6,
                    cursor: 'pointer',
                    ':hover': {
                      backgroundColor: 'var(--color-bg-hover)',
                    },
                  }}
                >
                  {StepContent}
                </UnstyledButton>
              );
            }

            return (
              <div key={step.id} style={{}}>
                {StepContent}
              </div>
            );
          })}

          {isAllComplete && (
            <Group justify="center" mt="xs" p="xs">
              <Text size="sm" c="green" fw="bold">
                🎉 Great job! You&apos;re all set up.
              </Text>
            </Group>
          )}
        </Stack>
      </Collapse>
    </Card>
  );
};

export default OnboardingChecklist;
