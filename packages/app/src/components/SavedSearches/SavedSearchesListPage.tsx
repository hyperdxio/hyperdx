import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Router from 'next/router';
import { useQueryState } from 'nuqs';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Container,
  Flex,
  Group,
  Select,
  SimpleGrid,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconBell,
  IconBellFilled,
  IconLayoutGrid,
  IconList,
  IconSearch,
  IconTable,
} from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { ListingRow } from '@/components/ListingListRow';
import { PageHeader } from '@/components/PageHeader';
import { useDeleteSavedSearch, useSavedSearches } from '@/savedSearch';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import type { SavedSearchWithEnhancedAlerts } from '@/types';
import { useConfirm } from '@/useConfirm';

import { withAppNav } from '../../layout';

function AlertStatusIcon({
  alerts,
}: {
  alerts?: SavedSearchWithEnhancedAlerts['alerts'];
}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const alertingCount = alerts.filter(a => a.state === AlertState.ALERT).length;
  return (
    <Tooltip
      label={
        alertingCount > 0
          ? `${alertingCount} alert${alertingCount > 1 ? 's' : ''} triggered`
          : 'Alerts configured'
      }
    >
      {alertingCount > 0 ? (
        <IconBellFilled size={14} color="var(--mantine-color-red-filled)" />
      ) : (
        <IconBell size={14} />
      )}
    </Tooltip>
  );
}

export default function SavedSearchesListPage() {
  const brandName = useBrandDisplayName();
  const { data: savedSearches, isLoading, isError } = useSavedSearches();
  const confirm = useConfirm();
  const deleteSavedSearch = useDeleteSavedSearch();
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useQueryState('tag');
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>({
    key: 'savedSearchesViewMode',
    defaultValue: 'grid',
  });

  const allTags = useMemo(() => {
    if (!savedSearches) return [];
    const tags = new Set<string>();
    savedSearches.forEach(s => s.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [savedSearches]);

  const filteredSavedSearches = useMemo(() => {
    if (!savedSearches) return [];
    let result = savedSearches;
    if (tagFilter) {
      result = result.filter(s => s.tags.includes(tagFilter));
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      const q = trimmedSearch.toLowerCase();
      result = result.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.tags.some(t => t.toLowerCase().includes(q)),
      );
    }
    return result.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [savedSearches, search, tagFilter]);

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = await confirm(
        'Are you sure you want to delete this saved search? This action cannot be undone.',
        'Delete',
        { variant: 'danger' },
      );
      if (!confirmed) return;
      deleteSavedSearch.mutate(id, {
        onSuccess: () => {
          notifications.show({
            message: 'Saved search deleted',
            color: 'green',
          });
        },
        onError: () => {
          notifications.show({
            message: 'Failed to delete saved search',
            color: 'red',
          });
        },
      });
    },
    [confirm, deleteSavedSearch],
  );

  return (
    <div
      data-testid="saved-searches-list-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <Head>
        <title>Saved Searches - {brandName}</title>
      </Head>
      <PageHeader>Saved Searches</PageHeader>
      <Container
        maw={1200}
        py="lg"
        px="lg"
        w="100%"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        <Flex justify="space-between" align="center" mb="lg" gap="sm">
          <Group gap="xs" style={{ flex: 1 }}>
            <TextInput
              placeholder="Search by name"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 400 }}
              miw={100}
            />
            {allTags.length > 0 && (
              <Select
                placeholder="Filter by tag"
                data={allTags}
                value={tagFilter}
                onChange={v => setTagFilter(v)}
                clearable
                searchable
                style={{ maxWidth: 200 }}
              />
            )}
          </Group>
          <Group gap="xs" align="center">
            <ActionIcon.Group>
              <ActionIcon
                variant={viewMode === 'grid' ? 'primary' : 'secondary'}
                size="input-sm"
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
              >
                <IconLayoutGrid size={16} />
              </ActionIcon>
              <ActionIcon
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                size="input-sm"
                onClick={() => setViewMode('list')}
                aria-label="List view"
              >
                <IconList size={16} />
              </ActionIcon>
            </ActionIcon.Group>
            <Button
              variant="primary"
              leftSection={<IconTable size={16} />}
              onClick={() => Router.push('/search')}
              data-testid="new-search-button"
            >
              New Search
            </Button>
          </Group>
        </Flex>

        {isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            Loading saved searches...
          </Text>
        ) : isError ? (
          <Text size="sm" c="red" ta="center" py="xl">
            Failed to load saved searches. Please try refreshing the page.
          </Text>
        ) : filteredSavedSearches.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            style={{ flex: 1, minHeight: 0 }}
          >
            <EmptyState
              icon={<IconTable size={32} />}
              title={
                search || tagFilter
                  ? 'No matching saved searches'
                  : 'No saved searches yet'
              }
            >
              <Button
                variant="primary"
                leftSection={<IconTable size={16} />}
                onClick={() => Router.push('/search')}
                data-testid="empty-new-search-button"
              >
                New Search
              </Button>
            </EmptyState>
          </Flex>
        ) : viewMode === 'list' ? (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Tags</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredSavedSearches.map(s => (
                <ListingRow
                  key={s.id}
                  id={s.id}
                  name={s.name}
                  href={`/search/${s.id}`}
                  tags={s.tags}
                  onDelete={handleDelete}
                  statusIcon={<AlertStatusIcon alerts={s.alerts} />}
                />
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {filteredSavedSearches.map(s => (
              <ListingCard
                key={s.id}
                name={s.name}
                href={`/search/${s.id}`}
                tags={s.tags}
                onDelete={() => handleDelete(s.id)}
                statusIcon={<AlertStatusIcon alerts={s.alerts} />}
              />
            ))}
          </SimpleGrid>
        )}
      </Container>
    </div>
  );
}

SavedSearchesListPage.getLayout = withAppNav;
