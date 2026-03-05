import { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Router from 'next/router';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Flex,
  Group,
  Menu,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconDots,
  IconLayoutGrid,
  IconList,
  IconPlus,
  IconSearch,
  IconServer,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';

import { PageHeader } from '@/components/PageHeader';
import { IS_K8S_DASHBOARD_ENABLED, IS_LOCAL_MODE } from '@/config';
import {
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
} from '@/dashboard';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import type { Dashboard } from './dashboard';
import { withAppNav } from './layout';

const PRESET_DASHBOARDS = [
  {
    name: 'Services',
    href: '/services',
    description: 'Monitor HTTP endpoints, latency, and error rates',
    icon: IconServer,
  },
  {
    name: 'ClickHouse',
    href: '/clickhouse',
    description: 'ClickHouse cluster health and query performance',
    icon: IconSettings,
  },
];

function DashboardCard({
  dashboard,
  onDelete,
}: {
  dashboard: Dashboard;
  onDelete: (id: string) => void;
}) {
  return (
    <Card
      component={Link}
      href={`/dashboards/${dashboard.id}`}
      withBorder
      padding="lg"
      radius="sm"
      style={{ cursor: 'pointer', textDecoration: 'none' }}
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text fw={500} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
          {dashboard.name}
        </Text>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="secondary"
              size="sm"
              onClick={e => e.preventDefault()}
            >
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={e => {
                e.preventDefault();
                onDelete(dashboard.id);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Group gap="xs" mt="xs">
        <Text size="xs" c="dimmed">
          {dashboard.tiles.length}{' '}
          {dashboard.tiles.length === 1 ? 'tile' : 'tiles'}
        </Text>
        {dashboard.tags.map(tag => (
          <Badge key={tag} variant="light" size="xs">
            {tag}
          </Badge>
        ))}
      </Group>
    </Card>
  );
}

function DashboardListRow({
  dashboard,
  onDelete,
}: {
  dashboard: Dashboard;
  onDelete: (id: string) => void;
}) {
  return (
    <Table.Tr
      style={{ cursor: 'pointer' }}
      onClick={() => Router.push(`/dashboards/${dashboard.id}`)}
    >
      <Table.Td>
        <Text
          component={Link}
          href={`/dashboards/${dashboard.id}`}
          fw={500}
          size="sm"
          style={{ textDecoration: 'none' }}
          onClick={e => e.stopPropagation()}
        >
          {dashboard.name}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {dashboard.tags.map(tag => (
            <Badge key={tag} variant="light" size="xs">
              {tag}
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {dashboard.tiles.length}
        </Text>
      </Table.Td>
      <Table.Td>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="secondary"
              size="sm"
              onClick={e => e.stopPropagation()}
            >
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={e => {
                e.stopPropagation();
                onDelete(dashboard.id);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Table.Td>
    </Table.Tr>
  );
}

function PresetDashboardCard({
  name,
  href,
  description,
  icon: Icon,
}: {
  name: string;
  href: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Card
      component={Link}
      href={href}
      withBorder
      padding="lg"
      radius="sm"
      style={{ cursor: 'pointer', textDecoration: 'none' }}
    >
      <Group gap="sm" mb="xs">
        <Icon size={18} />
        <Text fw={500}>{name}</Text>
      </Group>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
    </Card>
  );
}

export default function DashboardsListPage() {
  const brandName = useBrandDisplayName();
  const { data: dashboards, isLoading } = useDashboards();
  const createDashboard = useCreateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useLocalStorage<string>({
    key: 'dashboardsViewMode',
    defaultValue: 'grid',
  });

  const presets = useMemo(() => {
    if (IS_K8S_DASHBOARD_ENABLED) {
      return [
        ...PRESET_DASHBOARDS,
        {
          name: 'Kubernetes',
          href: '/kubernetes',
          description: 'Kubernetes cluster monitoring and pod health',
          icon: IconLayoutGrid,
        },
      ];
    }
    return PRESET_DASHBOARDS;
  }, []);

  const filteredDashboards = useMemo(() => {
    if (!dashboards) return [];
    if (!search.trim()) return dashboards;
    const q = search.toLowerCase();
    return dashboards.filter(
      d =>
        d.name.toLowerCase().includes(q) ||
        d.tags.some(t => t.toLowerCase().includes(q)),
    );
  }, [dashboards, search]);

  const handleCreate = useCallback(() => {
    if (IS_LOCAL_MODE) {
      Router.push('/dashboards');
      return;
    }
    createDashboard.mutate(
      { name: 'My Dashboard', tiles: [], tags: [] },
      {
        onSuccess: data => {
          Router.push(`/dashboards/${data.id}`);
        },
      },
    );
  }, [createDashboard]);

  const handleDelete = useCallback(
    (id: string) => {
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
    [deleteDashboard],
  );

  return (
    <div data-testid="dashboards-list-page">
      <Head>
        <title>Dashboards - {brandName}</title>
      </Head>
      <PageHeader>Dashboards</PageHeader>
      <Container maw={1200} py="lg" px="lg">
        <Flex justify="space-between" align="center" mb="lg" gap="sm">
          <TextInput
            placeholder="Search dashboards..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 400 }}
          />
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
              leftSection={<IconPlus size={16} />}
              onClick={handleCreate}
              loading={createDashboard.isPending}
              data-testid="create-dashboard-button"
            >
              New Dashboard
            </Button>
          </Group>
        </Flex>

        {!IS_LOCAL_MODE && (
          <>
            <Text fw={500} size="sm" c="dimmed" mb="sm">
              Preset Dashboards
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} mb="xl">
              {presets.map(p => (
                <PresetDashboardCard key={p.href} {...p} />
              ))}
            </SimpleGrid>
          </>
        )}

        <Text fw={500} size="sm" c="dimmed" mb="sm">
          {search
            ? `Results (${filteredDashboards.length})`
            : 'Your Dashboards'}
        </Text>

        {isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            Loading dashboards...
          </Text>
        ) : filteredDashboards.length === 0 ? (
          <Card withBorder padding="xl" radius="sm">
            <Stack align="center" gap="sm" py="lg">
              <IconLayoutGrid size={40} opacity={0.3} />
              <Text size="sm" c="dimmed" ta="center">
                {search
                  ? `No dashboards matching "${search}"`
                  : 'No dashboards yet. Create one to get started.'}
              </Text>
              {!search && (
                <Button
                  variant="primary"
                  size="sm"
                  leftSection={<IconPlus size={14} />}
                  onClick={handleCreate}
                  loading={createDashboard.isPending}
                >
                  Create Dashboard
                </Button>
              )}
            </Stack>
          </Card>
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
              <DashboardCard key={d.id} dashboard={d} onDelete={handleDelete} />
            ))}
          </SimpleGrid>
        )}
      </Container>
    </div>
  );
}

DashboardsListPage.getLayout = withAppNav;
