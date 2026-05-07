import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Button,
  Flex,
  Group,
  Menu,
  Paper,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconDeviceFloppy,
  IconDotsVertical,
  IconDownload,
  IconTags,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';

import { FavoriteButton } from '@/components/FavoriteButton';
import { Dashboard } from '@/dashboard';
import { EditablePageName } from '@/EditablePageName';
import { Tags } from '@/components/Tags';
import { FormatTime } from '@/useFormatTime';

type DashboardHeaderProps = {
  dashboard: Dashboard | undefined;
  dashboardHash: string | number | undefined;
  isLocalDashboard: boolean;
  hasTiles: boolean | undefined;
  hasSavedQueryAndFilterDefaults: boolean;
  onCreateDashboard: () => void;
  onRenameDashboard: (editedName: string) => void;
  onUpdateTags: (newTags: string[]) => void;
  onExportDashboard: () => void;
  onImportDashboard: () => void;
  onSaveQuery: () => void;
  onRemoveSavedQuery: () => void;
  onDeleteDashboard: () => void;
};

export function DashboardHeader({
  dashboard,
  dashboardHash,
  isLocalDashboard,
  hasTiles,
  hasSavedQueryAndFilterDefaults,
  onCreateDashboard,
  onRenameDashboard,
  onUpdateTags,
  onExportDashboard,
  onImportDashboard,
  onSaveQuery,
  onRemoveSavedQuery,
  onDeleteDashboard,
}: DashboardHeaderProps) {
  return (
    <>
      {isLocalDashboard ? (
        <>
          <Breadcrumbs mb="xs" mt="xs" fz="sm">
            <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
              Dashboards
            </Anchor>
            <Text fz="sm" c="dimmed">
              Temporary Dashboard
            </Text>
          </Breadcrumbs>
          <Paper my="lg" p="md" data-testid="temporary-dashboard-banner">
            <Flex justify="space-between" align="center">
              <Text size="sm">
                This is a temporary dashboard and can not be saved.
              </Text>
              <Button
                variant="primary"
                fw={400}
                onClick={onCreateDashboard}
                data-testid="create-dashboard-button"
              >
                Create New Saved Dashboard
              </Button>
            </Flex>
          </Paper>
        </>
      ) : (
        <Group align="flex-start" mb="xs" mt="xs" justify="space-between">
          <Breadcrumbs fz="sm">
            <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
              Dashboards
            </Anchor>
            <Text fz="sm" c="dimmed" maw={500} truncate="end" lh={1}>
              {dashboard?.name ?? 'Untitled'}
            </Text>
          </Breadcrumbs>
          {!isLocalDashboard && dashboard && (
            <Text size="xs" c="dimmed">
              {dashboard.createdBy && (
                <span>
                  Created by{' '}
                  {dashboard.createdBy.name || dashboard.createdBy.email}.{' '}
                </span>
              )}
              {dashboard.updatedAt && (
                <Tooltip
                  label={
                    <>
                      <FormatTime value={dashboard.updatedAt} format="short" />
                      {dashboard.updatedBy
                        ? ` by ${dashboard.updatedBy.name || dashboard.updatedBy.email}`
                        : ''}
                    </>
                  }
                >
                  <span>{`Updated ${formatDistanceToNow(new Date(dashboard.updatedAt), { addSuffix: true })}.`}</span>
                </Tooltip>
              )}
            </Text>
          )}
        </Group>
      )}
      <Flex mt="xs" mb="md" justify="space-between" align="flex-start">
        <EditablePageName
          key={`${dashboardHash}`}
          name={dashboard?.name ?? ''}
          onSave={onRenameDashboard}
        />
        <Group gap="xs">
          {!isLocalDashboard && dashboard?.id && (
            <FavoriteButton
              resourceType="dashboard"
              resourceId={dashboard.id}
            />
          )}
          {!isLocalDashboard && dashboard?.id && (
            <Tags
              allowCreate
              values={dashboard?.tags || []}
              onChange={onUpdateTags}
            >
              <Button
                variant="secondary"
                px="xs"
                size="xs"
                style={{ flexShrink: 0 }}
              >
                <IconTags size={14} className="me-2" />
                {dashboard?.tags?.length || 0}{' '}
                {dashboard?.tags?.length === 1 ? 'Tag' : 'Tags'}
              </Button>
            </Tags>
          )}
          {!isLocalDashboard /* local dashboards cant be "deleted" */ && (
            <Menu width={250}>
              <Menu.Target>
                <ActionIcon
                  variant="secondary"
                  size="input-xs"
                  data-testid="dashboard-menu-button"
                >
                  <IconDotsVertical size={14} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                {hasTiles && (
                  <Menu.Item
                    leftSection={<IconDownload size={16} />}
                    onClick={onExportDashboard}
                  >
                    Export Dashboard
                  </Menu.Item>
                )}
                <Menu.Item
                  leftSection={<IconUpload size={16} />}
                  onClick={onImportDashboard}
                >
                  {hasTiles ? 'Import New Dashboard' : 'Import Dashboard'}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  data-testid="save-default-query-filters-menu-item"
                  leftSection={<IconDeviceFloppy size={16} />}
                  onClick={onSaveQuery}
                >
                  {hasSavedQueryAndFilterDefaults
                    ? 'Update Default Query & Filters'
                    : 'Save Query & Filters as Default'}
                </Menu.Item>
                {hasSavedQueryAndFilterDefaults && (
                  <Menu.Item
                    data-testid="remove-default-query-filters-menu-item"
                    leftSection={<IconX size={16} />}
                    color="red"
                    onClick={onRemoveSavedQuery}
                  >
                    Remove Default Query & Filters
                  </Menu.Item>
                )}
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconTrash size={16} />}
                  color="red"
                  onClick={onDeleteDashboard}
                >
                  Delete Dashboard
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        {/* <Button variant="outline" size="sm">
          Save
        </Button> */}
      </Flex>
    </>
  );
}
