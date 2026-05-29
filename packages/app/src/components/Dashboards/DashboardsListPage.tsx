import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Router from 'next/router';
import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import {
  ActionIcon,
  Anchor,
  Button,
  Container,
  Flex,
  Group,
  Menu,
  MultiSelect,
  SimpleGrid,
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
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';

import { withAppNav } from '../../layout';

function getDashboardAlerts(tiles: Dashboard['tiles']) {
  return tiles.map(t => t.config.alert).filter(a => a != null);
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
];

export default function DashboardsListPage() {
  const brandName = useBrandDisplayName();
  const { data: dashboards, isLoading, isError } = useDashboards();
  const confirm = useConfirm();
  const createDashboard = useCreateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useQueryState(
    'tags',
    parseAsArrayOf(parseAsString)
      .withDefault([])
      .withOptions({ history: 'replace' }),
  );
  const [legacyTag, setLegacyTag] = useQueryState('tag');
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>({
    key: 'dashboardsViewMode',
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
    if (selectedTags.length > 0) {
      result = result.filter(d => d.tags.some(t => selectedTags.includes(t)));
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
  }, [dashboards, search, selectedTags]);

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
        'Delete',
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
      <PageHeader title="Dashboards" />
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
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} mb="sm">
          {PRESET_DASHBOARDS.map(p => (
            <ListingCard key={p.href} {...p} />
          ))}
        </SimpleGrid>
        <Text ta="right" mb="sm">
          <Anchor component={Link} href="/dashboards/templates" fz="sm">
            Browse dashboard templates &rarr;
          </Anchor>
        </Text>

        {favoritedDashboards.length > 0 && (
          <>
            <Text fw={500} size="sm" c="dimmed" mb="sm">
              Favorites
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
          </>
        )}

        <Text fw={500} size="sm" c="dimmed" mb="sm">
          Team Dashboards
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
                placeholder={
                  selectedTags.length === 0 ? 'Filter by tags' : undefined
                }
                data={allTags}
                value={selectedTags}
                onChange={setSelectedTags}
                clearable
                searchable
                style={{ flex: 1, maxWidth: 400 }}
                miw={200}
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
        </Flex>

        {isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            Loading dashboards...
          </Text>
        ) : isError ? (
          <Text size="sm" c="red" ta="center" py="xl">
            Failed to load dashboards. Please try refreshing the page.
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
                search || selectedTags.length > 0
                  ? 'No matching dashboards yet'
                  : 'No dashboards yet'
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
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {filteredDashboards.map(d => (
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
