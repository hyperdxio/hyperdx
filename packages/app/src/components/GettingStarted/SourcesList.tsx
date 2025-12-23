import React, { useState } from 'react';
import {
  Connection,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconRefresh,
  IconServer,
  IconStack,
} from '@tabler/icons-react';

import { TableSourceForm } from '@/components/SourceForm';
import { IS_LOCAL_MODE } from '@/config';
import { useConnections } from '@/connection';
import { useSources } from '@/source';
import { capitalizeFirstLetter } from '@/utils';

import styles from './GettingStarted.module.scss';

export interface SourcesListProps {
  onAddSource?: () => void;
  mockSources?: TSource[];
  mockConnections?: Connection[];
}

export function SourcesList({
  onAddSource,
  mockSources,
  mockConnections,
}: SourcesListProps) {
  const {
    data: fetchedConnections,
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch: refetchConnections,
  } = useConnections();
  const {
    data: fetchedSources,
    isLoading: isLoadingSources,
    error: sourcesError,
    refetch: refetchSources,
  } = useSources();

  // Use mock data if provided, otherwise use fetched data
  const connections = mockConnections ?? fetchedConnections;
  const sources = mockSources ?? fetchedSources;
  const [editedSourceId, setEditedSourceId] = useState<string | null>(null);
  const [isCreatingSource, setIsCreatingSource] = useState(false);

  // Skip loading/error states if using mock data
  const isLoading =
    !mockSources &&
    !mockConnections &&
    (isLoadingConnections || isLoadingSources);
  const error =
    !mockSources && !mockConnections && (connectionsError || sourcesError);

  if (isLoading) {
    return (
      <Card withBorder p="xl" radius="sm" className={styles.sourcesCard}>
        <Flex justify="center" align="center" py="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed" ml="sm">
            Loading sources...
          </Text>
        </Flex>
      </Card>
    );
  }

  if (error) {
    const handleRetry = () => {
      refetchConnections();
      refetchSources();
    };

    return (
      <Card withBorder p="md" radius="sm" className={styles.sourcesCard}>
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Failed to load sources"
          color="red"
          variant="light"
        >
          <Text size="sm" mb="sm">
            {error instanceof Error
              ? error.message
              : 'An error occurred while loading data sources.'}
          </Text>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconRefresh size={14} />}
            onClick={handleRetry}
          >
            Retry
          </Button>
        </Alert>
      </Card>
    );
  }

  const isEmpty = !sources || sources.length === 0;

  return (
    <Card withBorder p="md" radius="sm" className={styles.sourcesCard}>
      <Stack gap="md">
        {isEmpty && !isCreatingSource && (
          <Flex direction="column" align="center" py="xl" gap="sm">
            <IconStack size={32} color="var(--color-text-muted)" />
            <Text size="sm" c="dimmed" ta="center">
              No data sources configured yet.
            </Text>
            <Text size="xs" c="dimmed" ta="center">
              Add a source to start querying your data.
            </Text>
          </Flex>
        )}

        {sources?.map((s, index) => (
          <React.Fragment key={s.id}>
            <Flex justify="space-between" align="center">
              <div>
                <Text size="sm" fw={500}>
                  {s.name}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  <Group gap="xs">
                    {capitalizeFirstLetter(s.kind)}
                    <Group gap={4}>
                      <IconServer size={11} />
                      {connections?.find(c => c.id === s.connection)?.name}
                    </Group>
                    <Group gap={4}>
                      {s.from && (
                        <>
                          <IconStack size={11} />
                          {s.from.databaseName}
                          {s.kind === SourceKind.Metric ? '' : '.'}
                          {s.from.tableName}
                        </>
                      )}
                    </Group>
                  </Group>
                </Text>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() =>
                  setEditedSourceId(editedSourceId === s.id ? null : s.id)
                }
              >
                {editedSourceId === s.id ? (
                  <IconChevronUp size={13} />
                ) : (
                  <IconChevronDown size={13} />
                )}
              </Button>
            </Flex>
            {editedSourceId === s.id && (
              <Box mt="xs">
                <TableSourceForm
                  sourceId={s.id}
                  onSave={() => setEditedSourceId(null)}
                />
              </Box>
            )}
            {index < (sources?.length ?? 0) - 1 && <Divider />}
          </React.Fragment>
        ))}

        {isCreatingSource && (
          <>
            <Divider />
            <TableSourceForm
              isNew
              onCreate={() => setIsCreatingSource(false)}
              onCancel={() => setIsCreatingSource(false)}
            />
          </>
        )}

        {!IS_LOCAL_MODE && (
          <Flex justify="flex-end" pt="md">
            <Button
              variant="secondary"
              size="sm"
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                setIsCreatingSource(true);
                onAddSource?.();
              }}
            >
              Add source
            </Button>
          </Flex>
        )}
      </Stack>
    </Card>
  );
}
