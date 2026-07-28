import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Router from 'next/router';
import { useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Anchor,
  Button,
  Container,
  Flex,
  Group,
  Menu,
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
  IconChevronDown,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconList,
  IconPlus,
  IconSearch,
  IconUpload,
} from '@tabler/icons-react';

import { AlertStatusIcon } from '@/components/AlertStatusIcon';
import EmptyState from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ListingCard } from '@/components/ListingCard';
import { ListingRow } from '@/components/ListingListRow';
import { PageHeader } from '@/components/PageHeader';
import { IS_K8S_DASHBOARD_ENABLED } from '@/config';
import {
  type Dashboard,
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
} from '@/dashboard';
import { useFavorites } from '@/favorites';
import { withAppNav } from '@/layout';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';
import { groupByTags } from '@/utils/groupByTags';

function getDashboardAlerts(tiles: Dashboard['tiles']) {
  return tiles.map(t => t.config.alert).filter(a => a != null);
}

const PRESET_DASHBOARDS = [
  {
    nameKey: 'list.presets.services' as const,
    href: '/services',
    descriptionKey: 'list.presets.servicesDescription' as const,
  },
  {
    nameKey: 'list.presets.clickhouse' as const,
    href: '/clickhouse',
    descriptionKey: 'list.presets.clickhouseDescription' as const,
  },
  ...(IS_K8S_DASHBOARD_ENABLED
    ? [
        {
          nameKey: 'list.presets.kubernetes' as const,
          href: '/kubernetes',
          descriptionKey: 'list.presets.kubernetesDescription' as const,
        },
      ]
    : []),
];

export default function DashboardsListPage() {
  const { t } = useTranslation('dashboards');
  const brandName = useBrandDisplayName();
  const { data: dashboards, isLoading, isError } = useDashboards();
  const confirm = useConfirm();
  const createDashboard = useCreateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useQueryState('tag');
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>({
    key: 'dashboardsViewMode',
    defaultValue: 'grid',
  });

  const { data: favorites } = useFavorites();
  const favoritedDashboards = useMemo(() => {
    if (!dashboards || !favorites?.length) return [];

    const favoritedDashboardIds = new Set(
      favorites
        .filter(f => f.resourceType === 'dashboard')
        .map(f => f.resourceId),
    );

    return dashboards
      .filter(d => favoritedDashboardIds.has(d.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dashboards, favorites]);

  const allTags = useMemo(() => {
    if (!dashboards) return [];
    const tags = new Set<string>();
    dashboards.forEach(d => d.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [dashboards]);

  const filteredDashboards = useMemo(() => {
    if (!dashboards) return [];
    let result = dashboards;
    if (tagFilter) {
      result = result.filter(d => d.tags.includes(tagFilter));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        d =>
          d.name.toLowerCase().includes(q) ||
          d.tags.some(t => t.toLowerCase().includes(q)),
      );
    }
    return result.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [dashboards, search, tagFilter]);

  const tagGroups = useMemo(
    () => groupByTags(filteredDashboards, tagFilter),
    [filteredDashboards, tagFilter],
  );

  const handleCreate = useCallback(() => {
    createDashboard.mutate(
      { name: t('list.defaultName'), tiles: [], tags: [] },
      {
        onSuccess: data => {
          Router.push(`/dashboards/${data.id}`);
        },
        onError: () => {
          notifications.show({
            message: t('list.createFailed'),
            color: 'red',
          });
        },
      },
    );
  }, [createDashboard, t]);

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = await confirm(
        t('list.deleteConfirm'),
        t('list.deleteAction'),
        { variant: 'danger' },
      );
      if (!confirmed) return;
      deleteDashboard.mutate(id, {
        onSuccess: () => {
          notifications.show({
            message: t('list.deleted'),
            color: 'green',
          });
        },
        onError: () => {
          notifications.show({
            message: t('list.deleteFailed'),
            color: 'red',
          });
        },
      });
    },
    [confirm, deleteDashboard, t],
  );

  return (
    <div
      data-testid="dashboards-list-page"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <Head>
        <title>{t('list.browserTitle', { brandName })}</title>
      </Head>
      <PageHeader title={t('list.title')} />
      <Container
        maw={1200}
        py="lg"
        px="lg"
        w="100%"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        <Text fw={500} size="sm" c="dimmed" mb="sm">
          {t('list.preset')}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} mb="sm">
          {PRESET_DASHBOARDS.map(p => (
            <ListingCard
              key={p.href}
              name={t(p.nameKey)}
              href={p.href}
              description={t(p.descriptionKey)}
            />
          ))}
        </SimpleGrid>
        <Text ta="right" mb="sm">
          <Anchor component={Link} href="/dashboards/templates" fz="sm">
            {t('list.browseTemplates')}
          </Anchor>
        </Text>

        {favoritedDashboards.length > 0 && (
          <>
            <Text fw={500} size="sm" c="dimmed" mb="sm">
              {t('list.favorites')}
            </Text>
            <SimpleGrid
              cols={{ base: 1, sm: 2, md: 3 }}
              mb="xl"
              data-testid="favorite-dashboards-section"
            >
              {favoritedDashboards.map(d => (
                <ListingCard
                  key={d.id}
                  name={d.name}
                  href={`/dashboards/${d.id}`}
                  tags={d.tags}
                  description={t('list.tileCount', { count: d.tiles.length })}
                  onDelete={() => handleDelete(d.id)}
                  statusIcon={
                    <AlertStatusIcon alerts={getDashboardAlerts(d.tiles)} />
                  }
                  resourceId={d.id}
                  resourceType="dashboard"
                  updatedAt={d.updatedAt}
                  updatedBy={d.updatedBy?.name || d.updatedBy?.email}
                />
              ))}
            </SimpleGrid>
          </>
        )}

        <Text fw={500} size="sm" c="dimmed" mb="sm">
          {t('list.team')}
        </Text>

        <Flex justify="space-between" align="center" mb="lg" gap="sm">
          <Group gap="xs" style={{ flex: 1 }}>
            <TextInput
              placeholder={t('list.searchPlaceholder')}
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 400 }}
              miw={100}
            />
            {allTags.length > 0 && (
              <Select
                placeholder={t('list.tagPlaceholder')}
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
                aria-label={t('list.gridView')}
              >
                <IconLayoutGrid size={16} />
              </ActionIcon>
              <ActionIcon
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                size="input-sm"
                onClick={() => setViewMode('list')}
                aria-label={t('list.listView')}
              >
                <IconList size={16} />
              </ActionIcon>
            </ActionIcon.Group>
            <Button
              component={Link}
              href="/dashboards/import"
              variant="secondary"
              leftSection={<IconUpload size={16} />}
              data-testid="import-dashboard-button"
            >
              {t('list.import')}
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  variant="primary"
                  leftSection={<IconPlus size={16} />}
                  rightSection={<IconChevronDown size={14} />}
                  loading={createDashboard.isPending}
                  data-testid="new-dashboard-button"
                >
                  {t('list.newDashboard')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconDeviceFloppy size={14} />}
                  onClick={handleCreate}
                  data-testid="create-dashboard-button"
                >
                  {t('list.savedDashboard')}
                  <Text size="xs" c="dimmed">
                    {t('list.savedDashboardDescription')}
                  </Text>
                </Menu.Item>
                <Menu.Item
                  component={Link}
                  href="/dashboards"
                  leftSection={<IconPlus size={14} />}
                  data-testid="temp-dashboard-button"
                >
                  {t('list.temporaryDashboard')}
                  <Text size="xs" c="dimmed">
                    {t('list.temporaryDashboardDescription')}
                  </Text>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Flex>

        {isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {t('list.loading')}
          </Text>
        ) : isError ? (
          <Text size="sm" c="red" ta="center" py="xl">
            {t('list.loadFailed')}
          </Text>
        ) : filteredDashboards.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            style={{ flex: 1, minHeight: 0 }}
          >
            <EmptyState
              icon={<IconLayoutGrid size={32} />}
              title={
                search || tagFilter ? t('list.emptyFiltered') : t('list.empty')
              }
            >
              <Group>
                <Button
                  component={Link}
                  href="/dashboards/import"
                  variant="secondary"
                  leftSection={<IconUpload size={16} />}
                  data-testid="empty-import-dashboard-button"
                >
                  {t('list.import')}
                </Button>
                <Button
                  variant="primary"
                  leftSection={<IconPlus size={16} />}
                  onClick={handleCreate}
                  loading={createDashboard.isPending}
                  data-testid="empty-create-dashboard-button"
                >
                  {t('list.newDashboard')}
                </Button>
              </Group>
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
              {filteredDashboards.map(d => (
                <ListingRow
                  key={d.id}
                  id={d.id}
                  name={d.name}
                  href={`/dashboards/${d.id}`}
                  tags={d.tags}
                  onDelete={handleDelete}
                  createdBy={d.createdBy?.name || d.createdBy?.email}
                  updatedAt={d.updatedAt}
                  updatedBy={d.updatedBy?.name || d.updatedBy?.email}
                  leftSection={
                    <Group gap={0} ps={4} justify="space-between" wrap="nowrap">
                      <FavoriteButton
                        resourceType="dashboard"
                        resourceId={d.id}
                        size="xs"
                      />
                      <AlertStatusIcon alerts={getDashboardAlerts(d.tiles)} />
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
                  {group.items.map(d => (
                    <ListingCard
                      key={d.id}
                      name={d.name}
                      href={`/dashboards/${d.id}`}
                      tags={d.tags}
                      description={t('list.tileCount', {
                        count: d.tiles.length,
                      })}
                      onDelete={() => handleDelete(d.id)}
                      statusIcon={
                        <AlertStatusIcon alerts={getDashboardAlerts(d.tiles)} />
                      }
                      resourceId={d.id}
                      resourceType="dashboard"
                      updatedAt={d.updatedAt}
                      updatedBy={d.updatedBy?.name || d.updatedBy?.email}
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

DashboardsListPage.getLayout = withAppNav;
