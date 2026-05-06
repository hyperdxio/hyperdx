import React, { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Router from 'next/router';
import { formatDistanceToNow } from 'date-fns';
import type { TSource } from '@berg/common-utils/dist/types';
import {
  ActionIcon,
  Alert,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconClock,
  IconDatabase,
  IconPencil,
  IconSearch,
  IconStack,
  IconTerminal2,
  IconTrash,
} from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useDeleteSource, useSources } from '@/source';
import { useConfirm } from '@/useConfirm';

import { EditSourceModal } from './EditSourceModal';

/**
 * Build the dotted reference shown in the Table column. Berg-native sources
 * carry `catalog/database/table`; older sources still use the legacy
 * `from.databaseName/tableName` pair, so we fall back to that.
 */
function tableRef(s: TSource): string {
  if (s.catalog && s.database && s.table) {
    return `${s.catalog}/${s.database}/${s.table}`;
  }
  if (s.from?.databaseName && s.from?.tableName) {
    return `${s.from.databaseName}/${s.from.tableName}`;
  }
  return '—';
}

function displayName(s: TSource): string {
  return s.displayName || s.name || '(unnamed)';
}

function timeColumnOf(s: TSource): string | undefined {
  return s.timestampColumn || s.timestampValueExpression || undefined;
}

export default function SourcesList() {
  const { data: sources, isLoading, isError, error, refetch } = useSources();
  const deleteSource = useDeleteSource();
  const confirm = useConfirm();

  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<TSource | null>(null);

  const filtered = useMemo(() => {
    if (!sources) return [];
    const q = filter.trim().toLowerCase();
    if (!q)
      return [...sources].sort((a, b) =>
        displayName(a).localeCompare(displayName(b)),
      );
    return sources
      .filter(s => {
        const name = displayName(s).toLowerCase();
        const ref = tableRef(s).toLowerCase();
        return name.includes(q) || ref.includes(q);
      })
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [sources, filter]);

  const handleDelete = useCallback(
    async (source: TSource) => {
      const ok = await confirm(
        `Delete source "${displayName(source)}"? This action cannot be undone.`,
        'Delete',
        { variant: 'danger' },
      );
      if (!ok) return;
      deleteSource.mutate(
        { id: source.id },
        {
          onSuccess: () =>
            notifications.show({ message: 'Source deleted', color: 'green' }),
          onError: () =>
            notifications.show({
              message: 'Failed to delete source',
              color: 'red',
            }),
        },
      );
    },
    [confirm, deleteSource],
  );

  const handleOpenInSearch = useCallback((s: TSource) => {
    // `?source=` matches the queryStateMap key used by `DBSearchPage` and
    // by Catalog → Search deep-links; standardised across both flows.
    Router.push({ pathname: '/search', query: { source: s.id } });
  }, []);

  const handleOpenInSQL = useCallback((s: TSource) => {
    // The dedicated `/sql` editor route lands later; reuse `/clickhouse`
    // for the SQL workspace. We use `?source=` here too so deep-linking to
    // Search and to SQL share the same query-string convention.
    Router.push({ pathname: '/clickhouse', query: { source: s.id } });
  }, []);

  return (
    <div
      data-testid="sources-list-page"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <Head>
        <title>Sources</title>
      </Head>
      <PageHeader>Sources</PageHeader>
      <Container
        maw={1200}
        py="lg"
        px="lg"
        w="100%"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <TextInput
              placeholder="Filter by name or table reference"
              leftSection={<IconSearch size={16} />}
              value={filter}
              onChange={e => setFilter(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 400 }}
              aria-label="Filter sources"
            />
            <Text size="sm" c="dimmed">
              {filtered.length} source{filtered.length === 1 ? '' : 's'}
            </Text>
          </Group>

          {isLoading && (
            <Group gap="xs" py="md">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Loading sources…
              </Text>
            </Group>
          )}

          {isError && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
              title="Failed to load sources"
            >
              <Text size="sm">{(error as Error)?.message}</Text>
              <Text
                size="xs"
                c="dimmed"
                mt="xs"
                component="button"
                onClick={() => refetch()}
                style={{ cursor: 'pointer', background: 'none', border: 0 }}
              >
                Retry
              </Text>
            </Alert>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <EmptyState
              variant="card"
              icon={<IconStack size={28} />}
              title={
                sources && sources.length > 0
                  ? 'No sources match this filter'
                  : 'No sources yet'
              }
              description={
                sources && sources.length > 0 ? (
                  'Try a different search term.'
                ) : (
                  <>
                    Pick a table from the <Link href="/catalog">Catalog</Link>{' '}
                    and click "Save as Source" to register it here.
                  </>
                )
              }
            />
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <Table
              withTableBorder
              verticalSpacing="xs"
              striped
              highlightOnHover
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Table</Table.Th>
                  <Table.Th>Time column</Table.Th>
                  <Table.Th>Default sort</Table.Th>
                  <Table.Th>Last queried</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map(s => {
                  const ts = timeColumnOf(s);
                  return (
                    <Table.Tr key={s.id} data-testid={`source-row-${s.id}`}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {ts && (
                            <Tooltip label={`time column: ${ts}`}>
                              <IconClock size={14} aria-label="time-enabled" />
                            </Tooltip>
                          )}
                          <Text size="sm" fw={500}>
                            {displayName(s)}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <IconDatabase size={12} />
                          <Text size="xs" ff="monospace">
                            {tableRef(s)}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {ts ? (
                          <Text size="xs" ff="monospace">
                            {ts}
                          </Text>
                        ) : (
                          <Text size="xs" c="dimmed">
                            — flat
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace" c="dimmed">
                          {s.defaultSort || s.orderByExpression || '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {s.lastQueriedAt
                            ? `${formatDistanceToNow(new Date(s.lastQueriedAt))} ago`
                            : 'Never'}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label="Open in Search">
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              aria-label={`Open ${displayName(s)} in Search`}
                              onClick={() => handleOpenInSearch(s)}
                            >
                              <IconSearch size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Open in SQL">
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              aria-label={`Open ${displayName(s)} in SQL`}
                              onClick={() => handleOpenInSQL(s)}
                            >
                              <IconTerminal2 size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Edit">
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              aria-label={`Edit ${displayName(s)}`}
                              onClick={() => setEditing(s)}
                            >
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              aria-label={`Delete ${displayName(s)}`}
                              onClick={() => handleDelete(s)}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Container>

      {editing && (
        <EditSourceModal
          opened
          onClose={() => setEditing(null)}
          source={editing}
        />
      )}
    </div>
  );
}
