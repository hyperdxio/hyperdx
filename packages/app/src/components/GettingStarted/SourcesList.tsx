import React, { useState } from 'react';
import {
  Connection,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconDatabase,
  IconPlus,
  IconServer,
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
  const { data: fetchedConnections } = useConnections();
  const { data: fetchedSources } = useSources();

  // Use mock data if provided, otherwise use fetched data
  const connections = mockConnections ?? fetchedConnections;
  const sources = mockSources ?? fetchedSources;
  const [editedSourceId, setEditedSourceId] = useState<string | null>(null);
  const [isCreatingSource, setIsCreatingSource] = useState(false);

  return (
    <Card withBorder p="md" radius="sm" className={styles.sourcesCard}>
      <Stack gap="md">
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
                          <IconDatabase size={11} />
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
