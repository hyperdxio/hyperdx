import { useCallback, useState } from 'react';
import { Button, Group, Loader, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { TableSourceForm } from '@/components/Sources/SourceForm';
import { SourcesList } from '@/components/Sources/SourcesList';
import { useConnections } from '@/connection';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import {
  autoDetectOtelSources,
  useCreateSource,
  useSources,
  useUpdateSource,
} from '@/source';

export interface CreateSourcesPanelProps {
  onSourcesCreated?: () => void;
}

export function CreateSourcesPanel({
  onSourcesCreated,
}: CreateSourcesPanelProps) {
  const { data: connections } = useConnections();
  const { data: sources } = useSources();
  const metadata = useMetadataWithSettings();
  const createSourceMutation = useCreateSource();
  const updateSourceMutation = useUpdateSource();

  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const hasConnection = (connections?.length ?? 0) > 0;
  const hasSources = (sources?.length ?? 0) > 0;

  const handleAutoDetect = useCallback(async () => {
    const connectionId = connections?.[0]?.id;
    if (!connectionId) return;
    setIsAutoDetecting(true);
    try {
      const created = await autoDetectOtelSources({
        connectionId,
        metadata,
        createSource: createSourceMutation.mutateAsync,
        updateSource: updateSourceMutation.mutateAsync,
      });
      if (created.length === 0) {
        notifications.show({
          color: 'yellow',
          title: 'No tables detected',
          message: 'No OpenTelemetry tables found — add a source manually.',
        });
        setShowManual(true);
      } else {
        notifications.show({
          title: 'Success',
          message: `Detected and created ${created.length} source${
            created.length > 1 ? 's' : ''
          }.`,
        });
        onSourcesCreated?.();
      }
    } catch (err) {
      console.error('Error auto-detecting sources:', err);
      notifications.show({
        color: 'red',
        title: 'Error',
        message: 'Failed to auto-detect sources — add one manually.',
      });
      setShowManual(true);
    } finally {
      setIsAutoDetecting(false);
    }
  }, [
    connections,
    metadata,
    createSourceMutation,
    updateSourceMutation,
    onSourcesCreated,
  ]);

  if (!hasConnection) {
    return (
      <Text size="sm" c="dimmed">
        Connect to ClickHouse first to create data sources.
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {hasSources ? (
        <SourcesList
          withCard={false}
          variant="default"
          showEmptyState={false}
        />
      ) : (
        <Text size="sm" c="dimmed">
          Auto-detect OpenTelemetry tables in your ClickHouse server, or add a
          source manually.
        </Text>
      )}
      <Group gap="sm">
        <Button
          variant="primary"
          onClick={handleAutoDetect}
          disabled={isAutoDetecting}
          leftSection={isAutoDetecting ? <Loader size={14} /> : undefined}
        >
          Auto-detect sources
        </Button>
        <Button variant="secondary" onClick={() => setShowManual(s => !s)}>
          {showManual ? 'Hide manual setup' : 'Add source manually'}
        </Button>
      </Group>
      {showManual ? (
        <TableSourceForm
          isNew
          defaultName="Logs"
          onCreate={() => onSourcesCreated?.()}
        />
      ) : null}
    </Stack>
  );
}
