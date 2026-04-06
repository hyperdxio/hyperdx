import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Router from 'next/router';
import { useQueryState } from 'nuqs';
import {
  ActionIcon,
  Button,
  Container,
  Flex,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconLayoutGrid,
  IconList,
  IconSearch,
  IconTable,
} from '@tabler/icons-react';

import { AlertStatusIcon } from '@/components/AlertStatusIcon';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ListingCard } from '@/components/ListingCard';
import { ListingRow } from '@/components/ListingListRow';
import { PageHeader } from '@/components/PageHeader';
import { useFavorites } from '@/favorites';
import { useDeleteSavedSearch, useSavedSearches } from '@/savedSearch';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';
import { groupByTags } from '@/utils/groupByTags';

import { withAppNav } from '../../layout';

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

  const { data: favorites } = useFavorites();
  const favoritedSavedSearches = useMemo(() => {
    if (!savedSearches || !favorites?.length) return [];

    const favoritedSavedSearchIds = new Set(
      favorites
        .filter(f => f.resourceType === 'savedSearch')
        .map(f => f.resourceId),
    );

    return savedSearches
      .filter(s => favoritedSavedSearchIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [savedSearches, favorites]);

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

  const tagGroups = useMemo(
    () => groupByTags(filteredSavedSearches, tagFilter),
    [filteredSavedSearches, tagFilter],
  );

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
    <div data-testid="saved-searches-list-page">
      <Head>
        <title>Saved Searches - {brandName}</title>
      </Head>
      <PageHeader>Saved Searches</PageHeader>
      <Container maw={1200} py="lg" px="lg">
        {favoritedSavedSearches.length > 0 && (
          <>
            <Text fw={500} size="sm" c="dimmed" mb="sm">
              Favorites
            </Text>
            <SimpleGrid
              cols={{ base: 1, sm: 2, md: 3 }}
              mb="xl"
              data-testid="favorite-saved-searches-section"
            >
              {favoritedSavedSearches.map(s => (
                <ListingCard
                  key={s.id}
                  name={s.name}
                  href={`/search/${s.id}`}
                  tags={s.tags}
                  onDelete={() => handleDelete(s.id)}
                  statusIcon={<AlertStatusIcon alerts={s.alerts} />}
                  resourceId={s.id}
                  resourceType="savedSearch"
                />
              ))}
            </SimpleGrid>
          </>
        )}

        <Text fw={500} size="sm" c="dimmed" mb="sm">
          All Saved Searches
        </Text>

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
          <Stack align="center" gap="sm" py="xl">
            <IconTable size={40} opacity={0.3} />
            <Text size="sm" c="dimmed" ta="center">
              {search || tagFilter
                ? 'No matching saved searches.'
                : 'No saved searches yet.'}
            </Text>
            <Button
              variant="primary"
              leftSection={<IconTable size={16} />}
              onClick={() => Router.push('/search')}
              data-testid="empty-new-search-button"
            >
              New Search
            </Button>
          </Stack>
        ) : viewMode === 'list' ? (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
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
                  leftSection={
                    <Group gap={0} ps={4} justify="space-between" wrap="nowrap">
                      <FavoriteButton
                        resourceType="savedSearch"
                        resourceId={s.id}
                        size="xs"
                      />
                      <AlertStatusIcon alerts={s.alerts} />
                    </Group>
                  }
                />
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Stack gap="lg">
            {tagGroups.map(group => (
              <div key={group.tag}>
                <Text fw={500} size="sm" c="dimmed" mb="sm">
                  {group.tag}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                  {group.items.map(s => (
                    <ListingCard
                      key={s.id}
                      name={s.name}
                      href={`/search/${s.id}`}
                      tags={s.tags}
                      onDelete={() => handleDelete(s.id)}
                      statusIcon={<AlertStatusIcon alerts={s.alerts} />}
                      resourceId={s.id}
                      resourceType="savedSearch"
                    />
                  ))}
                </SimpleGrid>
              </div>
            ))}
          </Stack>
        )}
      </Container>
    </div>
  );
}

SavedSearchesListPage.getLayout = withAppNav;
