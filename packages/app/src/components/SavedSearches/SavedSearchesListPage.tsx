import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Router from 'next/router';
import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import {
  ActionIcon,
  Button,
  Container,
  Flex,
  Group,
  MultiSelect,
  SimpleGrid,
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
import EmptyState from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ListingCard } from '@/components/ListingCard';
import { ListingRow } from '@/components/ListingListRow';
import { PageHeader } from '@/components/PageHeader';
import { useFavorites } from '@/favorites';
import { useDeleteSavedSearch, useSavedSearches } from '@/savedSearch';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';

import { withAppNav } from '../../layout';

export default function SavedSearchesListPage() {
  const brandName = useBrandDisplayName();
  const { data: savedSearches, isLoading, isError } = useSavedSearches();
  const confirm = useConfirm();
  const deleteSavedSearch = useDeleteSavedSearch();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useQueryState(
    'tags',
    parseAsArrayOf(parseAsString)
      .withDefault([])
      .withOptions({ history: 'replace' }),
  );
  const [legacyTag, setLegacyTag] = useQueryState('tag');
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>({
    key: 'savedSearchesViewMode',
    defaultValue: 'grid',
  });

  // Backward compat for shared links / bookmarks built before multi-select.
  // `?tag=foo` becomes `?tags=foo` once on mount. Modern `?tags=...` wins
  // when both are present.
  useEffect(() => {
    if (legacyTag) {
      if (selectedTags.length === 0) {
        setSelectedTags([legacyTag]);
      }
      setLegacyTag(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (selectedTags.length > 0) {
      result = result.filter(s => s.tags.some(t => selectedTags.includes(t)));
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
  }, [savedSearches, search, selectedTags]);

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
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Head>
        <title>Saved Searches - {brandName}</title>
      </Head>
      <PageHeader title="Saved Searches" />
      <Container
        maw={1200}
        py="lg"
        px="lg"
        w="100%"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
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
                  updatedAt={s.updatedAt}
                  updatedBy={s.updatedBy?.name || s.updatedBy?.email}
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
              <MultiSelect
                placeholder="Filter by tags"
                data={allTags}
                value={selectedTags}
                onChange={setSelectedTags}
                clearable
                searchable
                style={{ flex: 1, maxWidth: 400 }}
                miw={200}
                data-testid="tag-filter"
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
                search || selectedTags.length > 0
                  ? 'No matching saved searches yet'
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
                <Table.Th w={40} />
                <Table.Th>Name</Table.Th>
                <Table.Th>Tags</Table.Th>
                <Table.Th>Created By</Table.Th>
                <Table.Th>Last Updated</Table.Th>
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
                  createdBy={s.createdBy?.name || s.createdBy?.email}
                  updatedAt={s.updatedAt}
                  updatedBy={s.updatedBy?.name || s.updatedBy?.email}
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
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {filteredSavedSearches.map(s => (
              <ListingCard
                key={s.id}
                name={s.name}
                href={`/search/${s.id}`}
                tags={s.tags}
                onDelete={() => handleDelete(s.id)}
                statusIcon={<AlertStatusIcon alerts={s.alerts} />}
                resourceId={s.id}
                resourceType="savedSearch"
                updatedAt={s.updatedAt}
                updatedBy={s.updatedBy?.name || s.updatedBy?.email}
              />
            ))}
          </SimpleGrid>
        )}
      </Container>
    </div>
  );
}

SavedSearchesListPage.getLayout = withAppNav;
