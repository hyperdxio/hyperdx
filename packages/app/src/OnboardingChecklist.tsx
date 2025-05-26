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

import { useQueriedChartConfig } from './hooks/useChartConfig';
import api from './api';
import { useConnections } from './connection';
import Icon from './Icon';
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
    const threeDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3);
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
    <Card
      withBorder
      p="xs"
      mb="sm"
      radius="md"
      style={{
        background: 'var(--mantine-color-dark-8)',
        borderColor: 'var(--mantine-color-dark-4)',
      }}
    >
      <Group justify="space-between" align="center" mb={isCollapsed ? 0 : 'xs'}>
        <Group gap="xs" align="center">
          <Text size="sm" fw="bold" c="gray.3">
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
          <i
            className={`bi bi-chevron-${isCollapsed ? 'down' : 'up'} text-slate-400`}
            style={{ fontSize: 12 }}
          />
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
                      ? '1px solid var(--mantine-color-green-6)'
                      : 'none',
                    backgroundColor: step.isComplete
                      ? 'transparent'
                      : 'var(--mantine-color-dark-5)',
                    color: step.isComplete
                      ? 'var(--mantine-color-green-6)'
                      : 'var(--mantine-color-gray-5)',
                    flexShrink: 0,
                  }}
                >
                  {step.isLoading ? (
                    <Loader size="xs" color="gray" />
                  ) : step.isComplete ? (
                    <i
                      className="bi bi-check"
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
                    c={step.isComplete ? 'gray.5' : 'gray.3'}
                    style={{
                      textDecoration: step.isComplete ? 'line-through' : 'none',
                      opacity: step.isComplete ? 0.8 : 1,
                    }}
                  >
                    {step.title}
                  </Text>
                  <Text size="xs" c="gray.6">
                    {step.description}
                  </Text>
                </div>

                {!step.isComplete && (step.href || step.onClick) && (
                  <i
                    className="bi bi-arrow-right"
                    style={{
                      fontSize: 12,
                      color: 'var(--mantine-color-gray-5)',
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
                        backgroundColor: 'var(--mantine-color-dark-7)',
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
                      backgroundColor: 'var(--mantine-color-dark-7)',
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
