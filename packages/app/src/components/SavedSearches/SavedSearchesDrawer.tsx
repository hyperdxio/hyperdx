import { useCallback, useMemo, useState } from 'react';
import Router from 'next/router';
import type { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Drawer,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch } from '@tabler/icons-react';

import { SavedSearchRow } from '@/components/SavedSearches/SavedSearchRow';
import { useFavorites } from '@/favorites';
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearches,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useConfirm } from '@/useConfirm';

type SavedSearchesTab = 'all' | 'favorites';

/** "Report" -> "Report (copy)", then "Report (copy 2)" once that name is taken. */
export function duplicateName(
  name: string,
  existing: { name: string }[],
): string {
  const taken = new Set(existing.map(savedSearch => savedSearch.name));
  const candidate = `${name} (copy)`;
  if (!taken.has(candidate)) return candidate;

  let suffix = 2;
  while (taken.has(`${name} (copy ${suffix})`)) suffix++;
  return `${name} (copy ${suffix})`;
}

export function SavedSearchesDrawer({
  opened,
  onClose,
  activeSavedSearchId,
}: {
  opened: boolean;
  onClose: () => void;
  activeSavedSearchId?: string;
}) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const { data: savedSearches, isLoading, isError } = useSavedSearches();
  const { data: favorites } = useFavorites();
  const deleteSavedSearch = useDeleteSavedSearch();
  const createSavedSearch = useCreateSavedSearch();
  const updateSavedSearch = useUpdateSavedSearch();
  const confirm = useConfirm();
  const [tab, setTab] = useState<SavedSearchesTab>('all');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const favoriteIds = useMemo(
    () =>
      new Set(
        (favorites ?? [])
          .filter(favorite => favorite.resourceType === 'savedSearch')
          .map(favorite => favorite.resourceId),
      ),
    [favorites],
  );

  const tags = useMemo(
    () =>
      Array.from(
        new Set((savedSearches ?? []).flatMap(savedSearch => savedSearch.tags)),
      ).sort(),
    [savedSearches],
  );

  const filteredSavedSearches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (savedSearches ?? [])
      .filter(savedSearch => tab === 'all' || favoriteIds.has(savedSearch.id))
      .filter(
        savedSearch =>
          tagFilter == null || savedSearch.tags.includes(tagFilter),
      )
      .filter(
        savedSearch =>
          !query ||
          savedSearch.name.toLowerCase().includes(query) ||
          savedSearch.tags.some(tag => tag.toLowerCase().includes(query)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [favoriteIds, savedSearches, search, tab, tagFilter]);

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
          if (id === activeSavedSearchId) {
            Router.push('/search');
          }
        },
        onError: () =>
          notifications.show({
            message: 'Failed to delete saved search',
            color: 'red',
          }),
      });
    },
    [activeSavedSearchId, confirm, deleteSavedSearch],
  );

  const handleDuplicate = useCallback(
    (savedSearch: SavedSearchListApiResponse) => {
      // Alerts are deliberately not copied: they notify on their own schedule,
      // and a silent second alert is worse than none.
      createSavedSearch.mutate(
        {
          name: duplicateName(savedSearch.name, savedSearches ?? []),
          select: savedSearch.select,
          where: savedSearch.where,
          whereLanguage: savedSearch.whereLanguage,
          source: savedSearch.source,
          tags: savedSearch.tags,
          orderBy: savedSearch.orderBy,
          filters: savedSearch.filters,
        },
        {
          onSuccess: () =>
            notifications.show({
              message: 'Saved search duplicated',
              color: 'green',
            }),
          onError: () =>
            notifications.show({
              message: 'Failed to duplicate saved search',
              color: 'red',
            }),
        },
      );
    },
    [createSavedSearch, savedSearches],
  );

  const handleRename = useCallback(
    (id: string, name: string) => {
      updateSavedSearch.mutate(
        { id, name },
        {
          onSuccess: () =>
            notifications.show({
              message: 'Saved search renamed',
              color: 'green',
            }),
          onError: () =>
            notifications.show({
              message: 'Failed to rename saved search',
              color: 'red',
            }),
        },
      );
    },
    [updateSavedSearch],
  );

  const handleNewSearch = useCallback(() => {
    Router.push('/search');
  }, []);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Saved searches"
      // Right, so the panel never sits on top of the app nav.
      position="right"
      size={isMobile ? '100%' : 420}
      data-testid="saved-searches-drawer"
      closeButtonProps={{ 'aria-label': 'Close saved searches' }}
      styles={{ body: { height: 'calc(100% - 60px)', paddingTop: 0 } }}
    >
      <Stack gap="sm" h="100%">
        <Button
          variant="primary"
          leftSection={<IconPlus size={16} />}
          onClick={handleNewSearch}
          data-testid="new-search-button"
          fullWidth
        >
          New search
        </Button>
        <Tabs
          value={tab}
          onChange={value =>
            setTab(value === 'favorites' ? 'favorites' : 'all')
          }
        >
          <Tabs.List grow>
            <Tabs.Tab value="all">All</Tabs.Tab>
            <Tabs.Tab value="favorites">Favorites</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <TextInput
          placeholder="Search saved searches"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
        />
        {tags.length > 0 && (
          <Select
            placeholder="Filter by tag"
            data={tags}
            value={tagFilter}
            onChange={setTagFilter}
            clearable
            searchable
          />
        )}
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          {isLoading ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              Loading saved searches...
            </Text>
          ) : isError ? (
            <Text size="sm" c="red" ta="center" py="xl">
              Failed to load saved searches. Please try refreshing the page.
            </Text>
          ) : filteredSavedSearches.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {search || tagFilter
                ? 'No matching saved searches yet'
                : tab === 'favorites'
                  ? 'No favorite saved searches yet'
                  : 'No saved searches yet'}
            </Text>
          ) : (
            <Stack gap="xs" data-testid="saved-searches-list">
              {filteredSavedSearches.map(savedSearch => (
                <SavedSearchRow
                  key={savedSearch.id}
                  savedSearch={savedSearch}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onRename={handleRename}
                />
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Stack>
    </Drawer>
  );
}
