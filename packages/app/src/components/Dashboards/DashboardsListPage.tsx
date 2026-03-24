import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Router from 'next/router';
import { useQueryState } from 'nuqs';
import { Tooltip } from 'recharts';
import {
  ActionIcon,
  Button,
  ButtonGroup,
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
  IconPlus,
  IconSearch,
  IconUpload,
} from '@tabler/icons-react';

import { PageHeader } from '@/components/PageHeader';
import { IS_K8S_DASHBOARD_ENABLED } from '@/config';
import {
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
} from '@/dashboard';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';

import { withAppNav } from '../../layout';

import { DashboardCard } from './DashboardCard';
import { DashboardListRow } from './DashboardListRow';

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
  const [tagFilter, setTagFilter] = useQueryState('tag');
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>({
    key: 'dashboardsViewMode',
    defaultValue: 'grid',
  });

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
    <div data-testid="dashboards-list-page">
      <Head>
        <title>Dashboards - {brandName}</title>
      </Head>
      <PageHeader>Dashboards</PageHeader>
      <Container maw={1200} py="lg" px="lg">
        <Text fw={500} size="sm" c="dimmed" mb="sm">
          Preset Dashboards
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} mb="xl">
          {PRESET_DASHBOARDS.map(p => (
            <DashboardCard key={p.href} {...p} />
          ))}
        </SimpleGrid>

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
            <ButtonGroup>
              <Button
                component={Link}
                href="/dashboards/import"
                variant="secondary"
                leftSection={<IconUpload size={16} />}
                data-testid="import-dashboard-button"
              >
                Import
              </Button>
              <Button
                component={Link}
                leftSection={<IconPlus size={16} />}
                href="/dashboards"
                variant="secondary"
                data-testid="temp-dashboard-button"
              >
                Temporary
              </Button>
              <Button
                variant="primary"
                leftSection={<IconPlus size={16} />}
                onClick={handleCreate}
                loading={createDashboard.isPending}
                data-testid="create-dashboard-button"
              >
                New Dashboard
              </Button>
            </ButtonGroup>
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
          <Stack align="center" gap="sm" py="xl">
            <IconLayoutGrid size={40} opacity={0.3} />
            <Text size="sm" c="dimmed" ta="center">
              {search || tagFilter
                ? `No matching dashboards yet.`
                : 'No dashboards yet.'}
            </Text>
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
          </Stack>
        ) : viewMode === 'list' ? (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Tags</Table.Th>
                <Table.Th>Tiles</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredDashboards.map(d => (
                <DashboardListRow
                  key={d.id}
                  dashboard={d}
                  onDelete={handleDelete}
                />
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {filteredDashboards.map(d => (
              <DashboardCard
                key={d.id}
                name={d.name}
                href={`/dashboards/${d.id}`}
                tags={d.tags}
                description={`${d.tiles.length} ${d.tiles.length === 1 ? 'tile' : 'tiles'}`}
                onDelete={() => handleDelete(d.id)}
              />
            ))}
          </SimpleGrid>
        )}
      </Container>
    </div>
  );
}

DashboardsListPage.getLayout = withAppNav;
