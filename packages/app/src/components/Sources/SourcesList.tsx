import React, { useState } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
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
  Title,
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

import { IS_LOCAL_MODE } from '@/config';
import { useConnections } from '@/connection';
import { useSources } from '@/source';
import { capitalizeFirstLetter } from '@/utils';

import { TableSourceForm } from './SourceForm';

import styles from './Sources.module.scss';

export interface SourcesListProps {
  /** Callback when add source button is clicked */
  onAddSource?: () => void;
  /** Whether to wrap content in a Card component (default: true) */
  withCard?: boolean;
  /** Whether the card has a border (default: true) */
  withBorder?: boolean;
  /** Custom className for the card */
  cardClassName?: string;
  /** Visual variant: 'compact' for smaller text, 'default' for standard sizing */
  variant?: 'compact' | 'default';
  /** Whether to show empty state UI (default: true) */
  showEmptyState?: boolean;
}

export function SourcesList({
  onAddSource,
  withCard = true,
  withBorder = true,
  cardClassName,
  variant = 'compact',
  showEmptyState = true,
}: SourcesListProps) {
  const {
    data: connections,
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch: refetchConnections,
  } = useConnections();
  const {
    data: sources,
    isLoading: isLoadingSources,
    error: sourcesError,
    refetch: refetchSources,
  } = useSources();

  const [editedSourceId, setEditedSourceId] = useState<string | null>(null);
  const [isCreatingSource, setIsCreatingSource] = useState(false);

  const isLoading = isLoadingConnections || isLoadingSources;
  const error = connectionsError || sourcesError;

  const handleRetry = () => {
    refetchConnections();
    refetchSources();
  };

  // Sizing based on variant
  const textSize = variant === 'compact' ? 'sm' : 'md';
  const subtextSize = variant === 'compact' ? 'xs' : 'sm';
  const iconSize = variant === 'compact' ? 11 : 14;
  const buttonSize = variant === 'compact' ? 'xs' : 'sm';

  const Wrapper = withCard ? Card : React.Fragment;
  const wrapperProps = withCard
    ? {
        withBorder,
        p: 'md',
        radius: 'sm',
        className: cardClassName ?? styles.sourcesCard,
      }
    : {};

  if (isLoading) {
    return (
      <Wrapper {...wrapperProps}>
        <Flex justify="center" align="center" py="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed" ml="sm">
            Loading sources...
          </Text>
        </Flex>
      </Wrapper>
    );
  }

  if (error) {
    return (
      <Wrapper {...wrapperProps}>
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
      </Wrapper>
    );
  }

  const isEmpty = !sources || sources.length === 0;

  return (
    <Wrapper {...wrapperProps}>
      <Stack gap="md">
        {isEmpty && !isCreatingSource && showEmptyState && (
          <Flex direction="column" align="center" py="xl" gap="sm">
            <IconStack size={32} color="var(--color-text-muted)" />
            <Title size="sm" ta="center" c="var(--color-text-muted)">
              No data sources configured yet.
            </Title>
            <Text size="xs" ta="center" c="var(--color-text-muted)">
              Add a source to start querying your data.
            </Text>
          </Flex>
        )}

        {sources?.map((s, index) => (
          <React.Fragment key={s.id}>
            <Flex
              justify="space-between"
              align="center"
              opacity={s.disabled ? 0.5 : 1}
              style={{
                transition: 'opacity 0.2s ease',
              }}
            >
              <div style={{ flex: 1 }}>
                <Flex align="center" gap="sm">
                  <div>
                    <Group gap="xs" align="center">
                      <Text size={textSize} fw={500}>
                        {s.name}
                      </Text>
                    </Group>
                    <Text size={subtextSize} c="dimmed" mt={4}>
                      <Group gap="xs">
                        {capitalizeFirstLetter(s.kind)}
                        <Group gap={4}>
                          <IconServer size={iconSize} />
                          {connections?.find(c => c.id === s.connection)?.name}
                        </Group>
                        <Group gap={4}>
                          {s.from && (
                            <>
                              <IconStack size={iconSize} />
                              {s.from.databaseName}
                              {s.kind === SourceKind.Metric ? '' : '.'}
                              {s.from.tableName}
                            </>
                          )}
                        </Group>
                      </Group>
                    </Text>
                  </div>
                </Flex>
              </div>
              <ActionIcon
                variant="secondary"
                size={buttonSize}
                onClick={() =>
                  setEditedSourceId(editedSourceId === s.id ? null : s.id)
                }
              >
                {editedSourceId === s.id ? (
                  <IconChevronUp size={iconSize + 2} />
                ) : (
                  <IconChevronDown size={iconSize + 2} />
                )}
              </ActionIcon>
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
            {sources && sources.length > 0 && <Divider />}
            <TableSourceForm
              isNew
              onCreate={() => setIsCreatingSource(false)}
              onCancel={() => setIsCreatingSource(false)}
            />
          </>
        )}

        {!IS_LOCAL_MODE && !isCreatingSource && (
          <Flex
            justify="flex-end"
            pt={sources && sources.length > 0 ? 'md' : 0}
          >
            <Button
              variant="secondary"
              size={buttonSize}
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
    </Wrapper>
  );
}
