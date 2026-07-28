import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Router from 'next/router';
import { useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';
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
import EmptyState from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ListingCard } from '@/components/ListingCard';
import { ListingRow } from '@/components/ListingListRow';
import { PageHeader } from '@/components/PageHeader';
import { useFavorites } from '@/favorites';
import { withAppNav } from '@/layout';
import { useDeleteSavedSearch, useSavedSearches } from '@/savedSearch';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';
import { groupByTags } from '@/utils/groupByTags';

export default function SavedSearchesListPage() {
  const { t } = useTranslation('dashboards');
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
        t('savedSearches.deleteConfirm'),
        t('list.deleteAction'),
        { variant: 'danger' },
      );
      if (!confirmed) return;
      deleteSavedSearch.mutate(id, {
        onSuccess: () => {
          notifications.show({
            message: t('savedSearches.deleted'),
            color: 'green',
          });
        },
        onError: () => {
          notifications.show({
            message: t('savedSearches.deleteFailed'),
            color: 'red',
          });
        },
      });
    },
    [confirm, deleteSavedSearch, t],
  );

  return (
    <div
      data-testid="saved-searches-list-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Head>
        <title>{t('savedSearches.browserTitle', { brandName })}</title>
      </Head>
      <PageHeader title={t('savedSearches.title')} />
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
              {t('savedSearches.favorites')}
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
          {t('savedSearches.all')}
        </Text>

        <Flex justify="space-between" align="center" mb="lg" gap="sm">
          <Group gap="xs" style={{ flex: 1 }}>
            <TextInput
              placeholder={t('savedSearches.searchPlaceholder')}
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 400 }}
              miw={100}
            />
            {allTags.length > 0 && (
              <Select
                placeholder={t('savedSearches.tagPlaceholder')}
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
                aria-label={t('savedSearches.gridView')}
              >
                <IconLayoutGrid size={16} />
              </ActionIcon>
              <ActionIcon
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                size="input-sm"
                onClick={() => setViewMode('list')}
                aria-label={t('savedSearches.listView')}
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
              {t('savedSearches.new')}
            </Button>
          </Group>
        </Flex>

        {isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {t('savedSearches.loading')}
          </Text>
        ) : isError ? (
          <Text size="sm" c="red" ta="center" py="xl">
            {t('savedSearches.loadFailed')}
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
                  ? t('savedSearches.emptyFiltered')
                  : t('savedSearches.empty')
              }
            >
              <Button
                variant="primary"
                leftSection={<IconTable size={16} />}
                onClick={() => Router.push('/search')}
                data-testid="empty-new-search-button"
              >
                {t('savedSearches.new')}
              </Button>
            </EmptyState>
          </Flex>
        ) : viewMode === 'list' ? (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>{t('list.columns.name')}</Table.Th>
                <Table.Th>{t('list.columns.tags')}</Table.Th>
                <Table.Th>{t('list.columns.createdBy')}</Table.Th>
                <Table.Th>{t('list.columns.lastUpdated')}</Table.Th>
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
                      updatedAt={s.updatedAt}
                      updatedBy={s.updatedBy?.name || s.updatedBy?.email}
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
