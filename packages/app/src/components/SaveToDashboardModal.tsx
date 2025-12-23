import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';

import {
  Dashboard,
  Tile,
  useCreateDashboard,
  useDashboards,
  useUpdateDashboard,
} from '@/dashboard';
import {
  calculateNextTilePosition,
  getDefaultTileSize,
  makeId,
} from '@/utils/tilePositioning';

interface SaveToDashboardModalProps {
  chartConfig: SavedChartConfig;
  opened: boolean;
  onClose: () => void;
}

const CREATE_NEW_DASHBOARD_VALUE = '_new';

export default function SaveToDashboardModal({
  chartConfig,
  opened,
  onClose,
}: SaveToDashboardModalProps) {
  const queryClient = useQueryClient();
  const { data: dashboards, isLoading: isLoadingDashboards } = useDashboards();
  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();

  const { control, handleSubmit, reset, formState } = useForm<{
    dashboardId: string;
    newDashboardName: string;
  }>({
    defaultValues: {
      dashboardId: '',
      newDashboardName: '',
    },
  });

  const dashboardId = useWatch({ control, name: 'dashboardId' });
  const isCreatingNew = dashboardId === CREATE_NEW_DASHBOARD_VALUE;

  // Reset form when modal is closed
  useEffect(() => {
    if (!opened) {
      reset();
    }
  }, [opened, reset]);

  const dashboardOptions = [
    ...(dashboards?.map(d => ({ value: d.id, label: d.name })) || []),
    {
      value: CREATE_NEW_DASHBOARD_VALUE,
      label: 'Create New Dashboard',
    },
  ];

  const createNewTile = (dashboard: Dashboard): Tile => {
    const position = calculateNextTilePosition(dashboard.tiles);
    const size = getDefaultTileSize(chartConfig.displayType);

    return {
      id: makeId(),
      x: position.x,
      y: position.y,
      w: size.w,
      h: size.h,
      config: chartConfig,
    };
  };

  const onSubmit = handleSubmit(async data => {
    try {
      if (isCreatingNew) {
        // Create new dashboard with the chart as first tile
        if (!data.newDashboardName.trim()) {
          notifications.show({
            color: 'red',
            title: 'Validation Error',
            message: 'Dashboard name is required',
          });
          return;
        }

        const newTile = createNewTile({
          id: '',
          name: '',
          tiles: [],
          tags: [],
        });

        const result = await createDashboard.mutateAsync({
          name: data.newDashboardName.trim(),
          tiles: [newTile],
          tags: [],
        });

        notifications.show({
          color: 'green',
          title: 'Chart saved to dashboard',
          message: (
            <>
              View on{' '}
              <a
                href={`/dashboards/${result.id}`}
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {result.name}
              </a>
            </>
          ),
          autoClose: 5000,
        });

        onClose();
      } else {
        // Add chart to existing dashboard
        if (!data.dashboardId) {
          notifications.show({
            color: 'red',
            title: 'Validation Error',
            message: 'Please select a dashboard',
          });
          return;
        }

        // Get dashboard data from query cache
        const dashboardsData = queryClient.getQueryData<Dashboard[]>([
          'dashboards',
        ]);
        const targetDashboard = dashboardsData?.find(
          d => d.id === data.dashboardId,
        );

        if (!targetDashboard) {
          notifications.show({
            color: 'red',
            title: 'Error',
            message: 'Dashboard not found. Please refresh and try again.',
          });
          return;
        }

        const newTile = createNewTile(targetDashboard);

        await updateDashboard.mutateAsync({
          id: targetDashboard.id,
          tiles: [...targetDashboard.tiles, newTile],
        });

        notifications.show({
          color: 'green',
          title: 'Chart saved to dashboard',
          message: (
            <>
              View on{' '}
              <a
                href={`/dashboards/${targetDashboard.id}`}
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {targetDashboard.name}
              </a>
            </>
          ),
          autoClose: 5000,
        });

        onClose();
      }
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Error saving chart',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to save chart to dashboard',
      });
    }
  });

  const isLoading = createDashboard.isPending || updateDashboard.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Save to Dashboard"
      size="lg"
    >
      <form onSubmit={onSubmit}>
        <Stack gap="md">
          {/* Chart Preview */}
          <Card withBorder padding="sm">
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Chart Preview
              </Text>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  Name:
                </Text>
                <Text size="sm">{chartConfig.name || 'Untitled Chart'}</Text>
              </Group>
              {chartConfig.displayType && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    Type:
                  </Text>
                  <Text size="sm">{chartConfig.displayType}</Text>
                </Group>
              )}
            </Stack>
          </Card>

          {/* Dashboard Selection */}
          <Box>
            <Text size="xs" mb="xs">
              Dashboard *
            </Text>
            <Controller
              name="dashboardId"
              control={control}
              rules={{ required: true }}
              render={({ field }) => (
                <Select
                  {...field}
                  data={dashboardOptions}
                  placeholder="Select a dashboard"
                  searchable
                  disabled={isLoadingDashboards || isLoading}
                  nothingFoundMessage="No dashboards found"
                />
              )}
            />
          </Box>

          {/* New Dashboard Name (conditional) */}
          {isCreatingNew && (
            <Box>
              <Text size="xs" mb="xs">
                Dashboard Name *
              </Text>
              <Controller
                name="newDashboardName"
                control={control}
                rules={{ required: true }}
                render={({ field }) => (
                  <TextInput
                    {...field}
                    placeholder="Enter dashboard name"
                    disabled={isLoading}
                  />
                )}
              />
            </Box>
          )}

          {/* Actions */}
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading}>
              Save to Dashboard
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
