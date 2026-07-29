import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import {
  Drawer,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconSearch, IconTable } from '@tabler/icons-react';

import { AlertStatusIcon } from '@/components/AlertStatusIcon';
import EmptyState from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useFavorites } from '@/favorites';
import { useSavedSearches } from '@/savedSearch';

import classes from './SavedSearchesFlyout.module.scss';

function SavedSearchRow({
  savedSearch,
  isActive,
  onNavigate,
  linkPrefix,
}: {
  savedSearch: SavedSearchListApiResponse;
  isActive: boolean;
  onNavigate: () => void;
  linkPrefix: string;
}) {
  return (
    <Group gap="xs" wrap="nowrap" className={classes.row}>
      <FavoriteButton
        resourceType="savedSearch"
        resourceId={savedSearch.id}
        size="xs"
      />
      <UnstyledButton
        component={Link}
        href={`${linkPrefix}/${savedSearch.id}`}
        onClick={onNavigate}
        className={classes.rowLink}
        data-active={isActive || undefined}
        data-testid="saved-search-flyout-item"
      >
        <Text size="sm" truncate="end" flex={1}>
          {savedSearch.name}
        </Text>
        <AlertStatusIcon alerts={savedSearch.alerts} />
      </UnstyledButton>
    </Group>
  );
}

export function SavedSearchesFlyout({
  opened,
  onClose,
  currentSavedSearchId,
  linkPrefix = '/search',
}: {
  opened: boolean;
  onClose: () => void;
  currentSavedSearchId?: string | null;
  /** Base path for saved-search links (e.g. `/search` or `/explore`). */
  linkPrefix?: string;
}) {
  const { data: savedSearches, isLoading, isError } = useSavedSearches();
  const { data: favorites } = useFavorites();
  const [search, setSearch] = useState('');

  const favoritedIds = useMemo(
    () =>
      new Set(
        (favorites ?? [])
          .filter(f => f.resourceType === 'savedSearch')
          .map(f => f.resourceId),
      ),
    [favorites],
  );

  const filtered = useMemo(() => {
    const all = savedSearches ?? [];
    const q = search.trim().toLowerCase();
    const matched = q
      ? all.filter(
          s =>
            s.name.toLowerCase().includes(q) ||
            s.tags.some(t => t.toLowerCase().includes(q)),
        )
      : all;
    return matched.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [savedSearches, search]);

  const favorited = useMemo(
    () => filtered.filter(s => favoritedIds.has(s.id)),
    [filtered, favoritedIds],
  );
  const others = useMemo(
    () => filtered.filter(s => !favoritedIds.has(s.id)),
    [filtered, favoritedIds],
  );

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={560}
      title="Saved Searches"
      data-testid="saved-searches-flyout"
    >
      <Stack gap="sm" h="100%">
        <TextInput
          placeholder="Search saved searches"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          size="xs"
          data-testid="saved-searches-flyout-search"
        />

        {isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="lg">
            Loading saved searches...
          </Text>
        ) : isError ? (
          <Text size="sm" c="red" ta="center" py="lg">
            Failed to load saved searches.
          </Text>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<IconTable size={28} />}
            title={
              search ? 'No matching saved searches' : 'No saved searches yet'
            }
          />
        ) : (
          <ScrollArea style={{ flex: 1 }} type="hover">
            <Stack gap="lg" pr="xs">
              {favorited.length > 0 && (
                <div>
                  <Text fw={500} size="xs" c="dimmed" mb={6}>
                    Favorites
                  </Text>
                  <Stack gap={2}>
                    {favorited.map(s => (
                      <SavedSearchRow
                        key={s.id}
                        savedSearch={s}
                        isActive={s.id === currentSavedSearchId}
                        onNavigate={onClose}
                        linkPrefix={linkPrefix}
                      />
                    ))}
                  </Stack>
                </div>
              )}

              <div>
                {favorited.length > 0 && (
                  <Text fw={500} size="xs" c="dimmed" mb={6}>
                    All Saved Searches
                  </Text>
                )}
                <Stack gap={2}>
                  {others.map(s => (
                    <SavedSearchRow
                      key={s.id}
                      savedSearch={s}
                      isActive={s.id === currentSavedSearchId}
                      onNavigate={onClose}
                      linkPrefix={linkPrefix}
                    />
                  ))}
                </Stack>
              </div>
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </Drawer>
  );
}
