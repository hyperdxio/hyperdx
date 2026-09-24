import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ActionIcon,
  Button,
  Divider,
  NavLink,
  Popover,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronDown,
  IconSearch,
  IconStarFilled,
} from '@tabler/icons-react';

import { useFavorites } from '@/favorites';
import { useSavedSearches } from '@/savedSearch';

export function SavedSearchSwitcher({
  activeSavedSearchId,
  onManage,
  label,
}: {
  activeSavedSearchId?: string;
  onManage: () => void;
  /** Renders an inline chip carrying this text. Omit for a bare chevron. */
  label?: string;
}) {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const { data: savedSearches, isLoading } = useSavedSearches();
  const { data: favorites } = useFavorites();

  const favoriteIds = useMemo(
    () =>
      new Set(
        (favorites ?? [])
          .filter(favorite => favorite.resourceType === 'savedSearch')
          .map(favorite => favorite.resourceId),
      ),
    [favorites],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (savedSearches ?? [])
      .filter(savedSearch => savedSearch.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aFavorite = favoriteIds.has(a.id);
        const bFavorite = favoriteIds.has(b.id);
        if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [favoriteIds, query, savedSearches]);

  const close = () => {
    setOpened(false);
    setQuery('');
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      onClose={close}
      position="bottom-start"
      width={320}
      shadow="md"
      withinPortal
      trapFocus
    >
      <Popover.Target>
        {label ? (
          <Button
            variant="secondary"
            size="xs"
            rightSection={<IconChevronDown size={14} />}
            style={{ flexShrink: 0 }}
            data-testid="saved-search-switcher"
            onClick={() => setOpened(o => !o)}
          >
            {label}
          </Button>
        ) : (
          <Tooltip withArrow label="Switch saved search" fz="xs" color="gray">
            <ActionIcon
              variant="subtle"
              aria-label="Switch saved search"
              data-testid="saved-search-switcher"
              onClick={() => setOpened(o => !o)}
            >
              <IconChevronDown size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <TextInput
          placeholder="Find a saved search"
          leftSection={<IconSearch size={14} />}
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          size="xs"
          mb="xs"
        />
        <ScrollArea.Autosize mah={280}>
          {isLoading ? (
            <Text size="xs" c="dimmed" ta="center" py="md">
              Loading saved searches...
            </Text>
          ) : matches.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="md">
              {query ? 'No matching saved searches' : 'No saved searches yet'}
            </Text>
          ) : (
            matches.map(savedSearch => (
              <NavLink
                key={savedSearch.id}
                component={Link}
                href={`/search/${savedSearch.id}`}
                label={savedSearch.name}
                active={savedSearch.id === activeSavedSearchId}
                leftSection={
                  favoriteIds.has(savedSearch.id) ? (
                    <IconStarFilled size={12} />
                  ) : null
                }
                onClick={close}
              />
            ))
          )}
        </ScrollArea.Autosize>
        <Divider my="xs" />
        <Button
          variant="subtle"
          size="xs"
          fullWidth
          justify="start"
          data-testid="manage-saved-searches"
          onClick={() => {
            close();
            onManage();
          }}
        >
          Manage saved searches
        </Button>
      </Popover.Dropdown>
    </Popover>
  );
}
