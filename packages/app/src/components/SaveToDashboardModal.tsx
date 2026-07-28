import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('dashboards');
  const queryClient = useQueryClient();
  const { data: dashboards, isLoading: isLoadingDashboards } = useDashboards();
  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();

  const { control, handleSubmit, reset } = useForm<{
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
      label: t('saveChart.createNew'),
    },
  ];

  const createNewTile = (dashboard: Dashboard): Tile => {
    const size = getDefaultTileSize(chartConfig.displayType);
    const position = calculateNextTilePosition(dashboard.tiles, size.w);

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
            title: t('saveChart.validationError'),
            message: t('saveChart.nameRequired'),
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
          title: t('saveChart.saved'),
          message: (
            <>
              {t('saveChart.viewOn')}{' '}
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
            title: t('saveChart.validationError'),
            message: t('saveChart.selectRequired'),
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
            title: t('saveChart.error'),
            message: t('saveChart.notFound'),
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
          title: t('saveChart.saved'),
          message: (
            <>
              {t('saveChart.viewOn')}{' '}
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
        title: t('saveChart.saveError'),
        message:
          error instanceof Error ? error.message : t('saveChart.saveFailed'),
      });
    }
  });

  const isLoading = createDashboard.isPending || updateDashboard.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('saveChart.title')}
      size="lg"
    >
      <form onSubmit={onSubmit}>
        <Stack gap="md">
          {/* Chart Preview */}
          <Card withBorder padding="sm">
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                {t('saveChart.preview')}
              </Text>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {t('saveChart.name')}
                </Text>
                <Text size="sm">
                  {chartConfig.name || t('saveChart.untitled')}
                </Text>
              </Group>
              {chartConfig.displayType && (
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    {t('saveChart.type')}
                  </Text>
                  <Text size="sm">{chartConfig.displayType}</Text>
                </Group>
              )}
            </Stack>
          </Card>

          {/* Dashboard Selection */}
          <Box>
            <Text size="xs" mb="xs">
              {t('saveChart.dashboard')}
            </Text>
            <Controller
              name="dashboardId"
              control={control}
              rules={{ required: true }}
              render={({ field }) => (
                <Select
                  {...field}
                  data={dashboardOptions}
                  placeholder={t('saveChart.selectPlaceholder')}
                  searchable
                  disabled={isLoadingDashboards || isLoading}
                  nothingFoundMessage={t('saveChart.noneFound')}
                />
              )}
            />
          </Box>

          {/* New Dashboard Name (conditional) */}
          {isCreatingNew && (
            <Box>
              <Text size="xs" mb="xs">
                {t('saveChart.dashboardName')}
              </Text>
              <Controller
                name="newDashboardName"
                control={control}
                rules={{ required: true }}
                render={({ field }) => (
                  <TextInput
                    {...field}
                    placeholder={t('saveChart.namePlaceholder')}
                    disabled={isLoading}
                  />
                )}
              />
            </Box>
          )}

          {/* Actions */}
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose} disabled={isLoading}>
              {t('saveChart.cancel')}
            </Button>
            <Button type="submit" loading={isLoading}>
              {t('saveChart.save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
