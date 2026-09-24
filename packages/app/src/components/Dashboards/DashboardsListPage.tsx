import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Router from 'next/router';
import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs';
import {
  Anchor,
  Button,
  Container,
  Flex,
  Group,
  Menu,
  SimpleGrid,
  Table,
  Text,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconPlus,
  IconUpload,
} from '@tabler/icons-react';

import api from '@/api';
import { AlertStatusIcon } from '@/components/AlertStatusIcon';
import { DashboardsListToolbar } from '@/components/Dashboards/DashboardsListToolbar';
import {
  collectDashboardTags,
  DASHBOARD_SORT_VALUES,
  DASHBOARD_TAB_VALUES,
  type DashboardSort,
  type DashboardTab,
  DEFAULT_DASHBOARD_SORT,
  filterAndSortDashboards,
} from '@/components/Dashboards/dashboardsListUtils';
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

function getDashboardAlerts(tiles: Dashboard['tiles']) {
  return tiles.map(t => t.config.alert).filter(a => a != null);
}

function emptyStateTitle(tab: DashboardTab, hasFilters: boolean): string {
  if (hasFilters) return 'No matching dashboards yet';
  if (tab === 'favorites') return 'No favorite dashboards yet';
  if (tab === 'mine') return 'No dashboards created by you yet';
  return 'No dashboards yet';
}

const PRESET_DASHBOARDS = [
  {
    name: 'Services',
    href: '/services',
    description: 'Monitor HTTP endpoints, latency, and error rates',
  },
  {
    name: 'ClickHouse',
    href: '/clickhouse',
    description: 'ClickHouse cluster health and query performance',
  },
  ...(IS_K8S_DASHBOARD_ENABLED
    ? [
        {
          name: 'Kubernetes',
          href: '/kubernetes',
          description: 'Kubernetes cluster monitoring and pod health',
        },
      ]
    : []),
  {
    name: 'LLM',
    href: '/llm',
    description: 'LLM calls, token usage, cost, and latency by model',
  },
];

export default function DashboardsListPage() {
  const brandName = useBrandDisplayName();
  const { data: dashboards, isLoading, isError } = useDashboards();
  const { data: me, isPending: isMePending } = api.useMe();
  const confirm = useConfirm();
  const createDashboard = useCreateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useQueryState(
    'tag',
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [requestedTab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<DashboardTab>(DASHBOARD_TAB_VALUES).withDefault('all'),
  );
  const [sort, setSort] = useQueryState(
    'sort',
    parseAsStringEnum<DashboardSort>(DASHBOARD_SORT_VALUES).withDefault(
      DEFAULT_DASHBOARD_SORT,
    ),
  );
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>({
    key: 'dashboardsViewMode',
    defaultValue: 'grid',
  });

  const { data: favorites, isPending: isFavoritesPending } = useFavorites();

  // Treat an in-flight `me` as eligible so the tab does not flip to All and
  // back while the request settles.
  const canFilterByCreator = isMePending || me?.email != null;
  // Local mode has no user, so a shared ?tab=mine link would otherwise select
  // a tab the toolbar never renders and filter every dashboard away.
  const tab =
    requestedTab === 'mine' && !canFilterByCreator ? 'all' : requestedTab;
  // All does not read the current user or favorites, so a slow favorites
  // request should not hold the whole list.
  const isTabDataPending =
    (tab === 'mine' && isMePending) ||
    (tab === 'favorites' && isFavoritesPending);

  const favoriteIds = useMemo(
    () =>
      new Set(
        (favorites ?? [])
          .filter(f => f.resourceType === 'dashboard')
          .map(f => f.resourceId),
      ),
    [favorites],
  );

  const allTags = useMemo(
    () => collectDashboardTags(dashboards ?? []),
    [dashboards],
  );

  const visibleDashboards = useMemo(
    () =>
      filterAndSortDashboards({
        dashboards: dashboards ?? [],
        tab,
        favoriteIds,
        currentUserEmail: me?.email,
        tagFilter,
        search,
        sort,
      }),
    [dashboards, tab, favoriteIds, me?.email, tagFilter, search, sort],
  );

  const handleCreate = useCallback(() => {
    createDashboard.mutate(
      { name: 'My Dashboard', tiles: [], tags: [] },
      {
        onSuccess: data => {
          Router.push(`/dashboards/${data.id}`);
        },
        onError: () => {
          notifications.show({
            message: 'Failed to create dashboard',
            color: 'red',
          });
        },
      },
    );
  }, [createDashboard]);

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = await confirm(
        'Are you sure you want to delete this dashboard? This action cannot be undone.',
        'Delete Dashboard',
        { variant: 'danger' },
      );
      if (!confirmed) return;
      deleteDashboard.mutate(id, {
        onSuccess: () => {
          notifications.show({
            message: 'Dashboard deleted',
            color: 'green',
          });
        },
        onError: () => {
          notifications.show({
            message: 'Failed to delete dashboard',
            color: 'red',
          });
        },
      });
    },
    [confirm, deleteDashboard],
  );

  return (
    <div
      data-testid="dashboards-list-page"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <Head>
        <title>Dashboards - {brandName}</title>
      </Head>
      <PageHeader
        title="Dashboards"
        actions={
          <Group gap="xs" align="center">
            <Button
              component={Link}
              href="/dashboards/import"
              variant="secondary"
              leftSection={<IconUpload size={16} />}
              data-testid="import-dashboard-button"
            >
              Import
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
                  New Dashboard
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconDeviceFloppy size={14} />}
                  onClick={handleCreate}
                  data-testid="create-dashboard-button"
                >
                  Saved Dashboard
                  <Text size="xs" c="dimmed">
                    Persisted for your team
                  </Text>
                </Menu.Item>
                <Menu.Item
                  component={Link}
                  href="/dashboards"
                  leftSection={<IconPlus size={14} />}
                  data-testid="temp-dashboard-button"
                >
                  Temporary Dashboard
                  <Text size="xs" c="dimmed">
                    Lives in your browser only
                  </Text>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        }
      />
      <Container
        maw={1200}
        py="lg"
        px="lg"
        w="100%"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        <Text fw={500} size="sm" c="dimmed" mb="sm">
          Preset Dashboards
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} mb="sm">
          {PRESET_DASHBOARDS.map(p => (
            <ListingCard key={p.href} {...p} />
          ))}
        </SimpleGrid>
        <Text ta="right" mb="sm">
          <Anchor component={Link} href="/dashboards/templates" fz="sm">
            Browse dashboard templates &rarr;
          </Anchor>
        </Text>

        <DashboardsListToolbar
          tab={tab}
          onTabChange={setTab}
          canFilterByCreator={canFilterByCreator}
          search={search}
          onSearchChange={setSearch}
          tags={allTags}
          tagFilter={tagFilter}
          onTagFilterChange={tags => setTagFilter(tags.length ? tags : null)}
          sort={sort}
          onSortChange={setSort}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {isLoading || isTabDataPending ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            Loading dashboards...
          </Text>
        ) : isError ? (
          <Text size="sm" c="red" ta="center" py="xl">
            Failed to load dashboards. Please try refreshing the page.
          </Text>
        ) : visibleDashboards.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            style={{ flex: 1, minHeight: 0 }}
          >
            <EmptyState
              icon={<IconLayoutGrid size={32} />}
              title={emptyStateTitle(tab, !!(search || tagFilter.length))}
            >
              <Group>
                <Button
                  component={Link}
                  href="/dashboards/import"
                  variant="secondary"
                  leftSection={<IconUpload size={16} />}
                  data-testid="empty-import-dashboard-button"
                >
                  Import
                </Button>
                <Button
                  variant="primary"
                  leftSection={<IconPlus size={16} />}
                  onClick={handleCreate}
                  loading={createDashboard.isPending}
                  data-testid="empty-create-dashboard-button"
                >
                  New Dashboard
                </Button>
              </Group>
            </EmptyState>
          </Flex>
        ) : viewMode === 'list' ? (
          // Native scrollbars so the columns stay reachable by touch.
          <Table.ScrollContainer minWidth={700} type="native">
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
                {visibleDashboards.map(d => (
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
                      <Group
                        gap={0}
                        ps={4}
                        justify="space-between"
                        wrap="nowrap"
                      >
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
          </Table.ScrollContainer>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {visibleDashboards.map(d => (
              <ListingCard
                key={d.id}
                name={d.name}
                href={`/dashboards/${d.id}`}
                tags={d.tags}
                description={`${d.tiles.length} ${d.tiles.length === 1 ? 'tile' : 'tiles'}`}
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
        )}
      </Container>
    </div>
  );
}

DashboardsListPage.getLayout = withAppNav;
