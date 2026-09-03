import * as React from 'react';
import {
  AlertSource,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { Modal, Skeleton, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';

import api from '@/api';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import EmptyState from '@/components/EmptyState';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import type { AlertsPageItem } from '@/types';
import { useConfirm } from '@/useConfirm';
import {
  buildInlineAlertPayload,
  normalizeNoOpAlertScheduleFields,
  toAlertChannels,
} from '@/utils/alerts';
import { getApiErrorMessage } from '@/utils/apiErrors';

/**
 * Seed the chart editor from a persisted inline alert: its chart config with
 * the alert's own fields folded back in as the embedded `alert`, which is the
 * shape the editor edits. Saving splits them apart again.
 */
export function inlineAlertToChartConfig(
  alert: AlertsPageItem,
): SavedChartConfig | undefined {
  if (alert.chartConfig == null) {
    return undefined;
  }
  return {
    ...alert.chartConfig,
    alert: {
      id: alert._id,
      interval: alert.interval,
      threshold: alert.threshold,
      thresholdMax: alert.thresholdMax,
      thresholdType: alert.thresholdType,
      scheduleOffsetMinutes: alert.scheduleOffsetMinutes ?? 0,
      scheduleStartAt:
        alert.scheduleStartAt == null
          ? null
          : typeof alert.scheduleStartAt === 'string'
            ? alert.scheduleStartAt
            : alert.scheduleStartAt.toISOString(),
      // AlertsPageItem types a channel loosely (type?: string | null) while
      // the editor carries the strict shape. Copy channels through rather
      // than rebuilding them, so a fork's extra channel fields survive an
      // edit; only webhookId is coerced, because the picker needs a string.
      channels: toAlertChannels(alert).map(c => ({
        ...c,
        webhookId: c.webhookId ?? '',
      })) as NonNullable<SavedChartConfig['alert']>['channels'],
      name: alert.name ?? null,
      message: alert.message ?? null,
      note: alert.note ?? null,
      // Persisted null -> undefined for the NumberInput.
      numConsecutiveWindows: alert.numConsecutiveWindows ?? undefined,
    },
  };
}

/**
 * Full chart editor for an inline alert, so both the alert's fields and the
 * query behind them can be changed in one place — a tile alert edits its query
 * on the dashboard, but an inline alert has nowhere else to.
 *
 * The alerts list omits `chartConfig` (see the alerts API), so an alert opened
 * from a row is re-fetched here for its detail response.
 */
export function EditInlineAlertModal({
  alert,
  opened,
  onClose,
  dateRange,
}: {
  alert: AlertsPageItem;
  opened: boolean;
  onClose: () => void;
  /** Time range the editor's preview chart runs over. */
  dateRange: [Date, Date];
}) {
  const brandName = useBrandDisplayName();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const updateAlert = api.useUpdateAlert();
  const [isDirty, setIsDirty] = React.useState(false);

  // Only fetched when the alert we were handed has no config (an alerts-page
  // row), and only while open, so a long list doesn't fetch every alert.
  const needsFetch = alert.chartConfig == null;
  const { data: fetched, isLoading } = api.useAlert(
    opened && needsFetch ? alert._id : undefined,
  );
  const fullAlert = alert.chartConfig != null ? alert : fetched?.data;

  const chartConfig = React.useMemo(
    () => (fullAlert ? inlineAlertToChartConfig(fullAlert) : undefined),
    [fullAlert],
  );

  React.useEffect(() => {
    if (!opened) {
      setIsDirty(false);
    }
  }, [opened]);

  const handleClose = React.useCallback(async () => {
    if (updateAlert.isPending) return;
    if (
      isDirty &&
      !(await confirm(
        'You have unsaved changes. Discard them and close the editor?',
        'Discard',
      ))
    ) {
      return;
    }
    setIsDirty(false);
    onClose();
  }, [confirm, isDirty, onClose, updateAlert.isPending]);

  const onSave = React.useCallback(
    async (config: SavedChartConfig) => {
      const payload = buildInlineAlertPayload(config);
      if (payload == null) {
        notifications.show({
          color: 'red',
          title: 'Invalid alert',
          message: 'This alert must keep an alert configured to be saved.',
          autoClose: 5000,
        });
        return;
      }

      // Faithful view of which schedule keys the persisted alert has (the
      // detail response omits absent keys), so no-op schedule writes are
      // skipped for pre-migration alerts that never had them.
      const previousScheduleFields = {
        ...(fullAlert?.scheduleOffsetMinutes !== undefined && {
          scheduleOffsetMinutes: fullAlert.scheduleOffsetMinutes,
        }),
        ...(fullAlert?.scheduleStartAt !== undefined && {
          scheduleStartAt:
            fullAlert.scheduleStartAt == null
              ? null
              : typeof fullAlert.scheduleStartAt === 'string'
                ? fullAlert.scheduleStartAt
                : fullAlert.scheduleStartAt.toISOString(),
        }),
      };

      try {
        await updateAlert.mutateAsync({
          ...normalizeNoOpAlertScheduleFields(payload, previousScheduleFields),
          id: alert._id,
          source: AlertSource.INLINE,
        });
        notifications.show({
          color: 'green',
          message: 'Alert updated!',
          autoClose: 5000,
        });
        queryClient.invalidateQueries({
          queryKey: api.getAlertQueryKey(alert._id),
        });
        queryClient.invalidateQueries({ queryKey: api.getAlertsQueryKey() });
        setIsDirty(false);
        onClose();
      } catch (error) {
        // Keep the modal open so the user's edits aren't lost.
        console.error('Error updating alert:', error);
        notifications.show({
          color: 'red',
          // Most failures here are the API rejecting the edited query for a
          // specific, fixable reason; the generic line is for the rest.
          message: await getApiErrorMessage(
            error,
            `Something went wrong. Please contact ${brandName} team.`,
          ),
          autoClose: 5000,
        });
      }
    },
    [alert._id, brandName, fullAlert, onClose, queryClient, updateAlert],
  );

  return (
    <Modal
      data-testid="edit-inline-alert-modal"
      opened={opened}
      onClose={handleClose}
      title="Edit alert"
      size="90%"
      padding="xs"
      centered
    >
      {isLoading && (
        <Stack gap="md">
          <Skeleton h={32} w="40%" />
          <Skeleton h={320} w="100%" />
        </Stack>
      )}
      {!isLoading && chartConfig == null && (
        <EmptyState
          variant="card"
          title="Alert query unavailable"
          description="This alert's chart configuration could not be loaded."
        />
      )}
      {!isLoading && chartConfig != null && (
        <EditTimeChartForm
          data-testid="inline-alert-editor-form"
          chartConfig={chartConfig}
          dateRange={dateRange}
          onSave={onSave}
          onClose={handleClose}
          onDirtyChange={setIsDirty}
          isSaving={updateAlert.isPending}
          enableAlerts
          isAlertRequired
          showSaveToDashboard={false}
          autoRun
        />
      )}
    </Modal>
  );
}
