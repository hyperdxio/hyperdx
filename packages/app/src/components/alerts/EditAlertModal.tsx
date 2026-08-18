import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  type Alert,
  AlertIntervalSchema,
  AlertSource,
  AlertThresholdType,
  isRangeThresholdType,
  scheduleStartAtSchema,
  validateAlertScheduleOffsetMinutes,
  validateAlertThresholdMax,
  zAlertChannel,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert as MantineAlert,
  Button,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircleFilled } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import api from '@/api';
import { AlertNoteField } from '@/components/AlertNoteField';
import { AlertChannelForm } from '@/components/Alerts';
import { AlertScheduleFields } from '@/components/AlertScheduleFields';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useSavedSearch } from '@/savedSearch';
import { useSource } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import type { AlertsPageItem } from '@/types';
import { optionsToSelectData } from '@/utils';
import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_INTERVAL_OPTIONS,
  ALERT_THRESHOLD_TYPE_OPTIONS,
  intervalToMinutes,
  normalizeNoOpAlertScheduleFields,
  TILE_ALERT_INTERVAL_OPTIONS,
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

// Same validation as the saved-search alert modal: only the fields this form
// edits are validated; everything else (source discriminator fields, name,
// message, ...) passes through untouched so a save never drops them.
const EditAlertFormSchema = z
  .object({
    interval: AlertIntervalSchema,
    threshold: z.number(),
    thresholdMax: z.number().optional(),
    scheduleOffsetMinutes: z.number().int().min(0).default(0),
    scheduleStartAt: scheduleStartAtSchema,
    thresholdType: z.nativeEnum(AlertThresholdType),
    channel: zAlertChannel,
    // nullish() (not optional()): persisted alerts store this as null, which
    // optional() would reject.
    numConsecutiveWindows: z.number().int().min(1).nullish(),
  })
  .passthrough()
  .superRefine(validateAlertScheduleOffsetMinutes)
  .superRefine(validateAlertThresholdMax);

/**
 * Map the alert detail response onto the update (PUT) payload shape. Carries
 * the source discriminator fields (savedSearchId / dashboardId + tileId) and
 * the fields this form does not edit (name, message) so a save round-trips
 * them instead of clearing them server-side.
 */
export function alertToFormValues(alert: AlertsPageItem): Alert {
  const base = {
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
    channel: {
      type: 'webhook' as const,
      webhookId: alert.channel.webhookId ?? '',
    },
    name: alert.name ?? null,
    message: alert.message ?? null,
    note: alert.note ?? null,
    // Persisted null -> undefined for the NumberInput.
    numConsecutiveWindows: alert.numConsecutiveWindows ?? undefined,
  };

  if (alert.source === AlertSource.TILE) {
    return {
      ...base,
      source: AlertSource.TILE,
      dashboardId: alert.dashboardId ?? '',
      tileId: alert.tileId ?? '',
    };
  }

  return {
    ...base,
    source: AlertSource.SAVED_SEARCH,
    savedSearchId: alert.savedSearchId ?? '',
    groupBy: alert.groupBy,
  };
}

/**
 * Modal for editing an alert's configuration from the alert detail page.
 * Works for both saved-search and tile alerts; saved-search alerts
 * additionally expose the group-by expression (tile alerts derive grouping
 * from the chart config).
 */
export function EditAlertModal({
  alert,
  opened,
  onClose,
}: {
  alert: AlertsPageItem;
  opened: boolean;
  onClose: () => void;
}) {
  const brandName = useBrandDisplayName();
  const queryClient = useQueryClient();
  const updateAlert = api.useUpdateAlert();

  const isTileAlert = alert.source === AlertSource.TILE;

  // The group-by SQL editor needs the saved search's source table for
  // autocomplete (same lookup as the detail chart).
  const { data: savedSearch } = useSavedSearch(
    { id: alert.savedSearchId ?? '' },
    { enabled: !isTileAlert && alert.savedSearchId != null },
  );
  const { data: source } = useSource({ id: savedSearch?.source });

  const defaultValues = React.useMemo(() => alertToFormValues(alert), [alert]);

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { dirtyFields },
  } = useForm<Alert>({
    defaultValues,
    resolver: zodResolver(EditAlertFormSchema),
  });

  // Re-sync the form when the modal is (re)opened or the alert refreshes
  // while closed, without clobbering in-progress edits.
  React.useEffect(() => {
    if (!opened) {
      reset(defaultValues);
    }
  }, [opened, defaultValues, reset]);

  const thresholdType = useWatch({ control, name: 'thresholdType' });
  const threshold = useWatch({ control, name: 'threshold' });
  const thresholdMax = useWatch({ control, name: 'thresholdMax' });
  const channelType = useWatch({ control, name: 'channel.type' });
  const interval = useWatch({ control, name: 'interval' });
  const groupBy = useWatch({ control, name: 'groupBy' });
  const scheduleOffsetMinutes = useWatch({
    control,
    name: 'scheduleOffsetMinutes',
  });
  const numConsecutiveWindows = useWatch({
    control,
    name: 'numConsecutiveWindows',
  });

  const maxScheduleOffsetMinutes = Math.max(
    intervalToMinutes(interval ?? '5m') - 1,
    0,
  );
  const intervalOptions = isTileAlert
    ? TILE_ALERT_INTERVAL_OPTIONS
    : ALERT_INTERVAL_OPTIONS;
  const thresholdTypeOptions = isTileAlert
    ? TILE_ALERT_THRESHOLD_TYPE_OPTIONS
    : ALERT_THRESHOLD_TYPE_OPTIONS;
  const intervalLabel = ALERT_INTERVAL_OPTIONS[interval ?? '5m'];

  const onSubmit = handleSubmit(async data => {
    // Faithful view of which schedule keys the persisted alert actually has
    // (the detail response omits absent keys), so no-op schedule writes are
    // skipped for pre-migration alerts that never had them.
    const previousScheduleFields: {
      scheduleOffsetMinutes?: number;
      scheduleStartAt?: string | null;
    } = {
      ...(alert.scheduleOffsetMinutes !== undefined && {
        scheduleOffsetMinutes: alert.scheduleOffsetMinutes,
      }),
      ...(alert.scheduleStartAt !== undefined && {
        scheduleStartAt:
          alert.scheduleStartAt == null
            ? null
            : typeof alert.scheduleStartAt === 'string'
              ? alert.scheduleStartAt
              : alert.scheduleStartAt.toISOString(),
      }),
    };
    const payload = normalizeNoOpAlertScheduleFields(
      // `id` is not a registered form field, so carry it from the alert this
      // modal was opened with.
      { ...data, id: alert._id },
      previousScheduleFields,
      {
        preserveExplicitScheduleOffsetMinutes:
          dirtyFields.scheduleOffsetMinutes === true,
        preserveExplicitScheduleStartAt: dirtyFields.scheduleStartAt === true,
      },
    );
    try {
      await updateAlert.mutateAsync({ ...payload, id: alert._id });
      notifications.show({
        color: 'green',
        message: 'Alert updated!',
        autoClose: 5000,
      });
      // The detail page, alerts list, and the source-bound edit surfaces
      // (saved search modal / dashboard tile editor) all render this alert.
      queryClient.invalidateQueries({
        queryKey: api.getAlertQueryKey(alert._id),
      });
      queryClient.invalidateQueries({ queryKey: api.getAlertsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      onClose();
    } catch (error) {
      // Keep the modal open so the user's edits aren't lost.
      console.error('Error updating alert:', error);
      notifications.show({
        color: 'red',
        message: `Something went wrong. Please contact ${brandName} team.`,
        autoClose: 5000,
      });
    }
  });

  return (
    <Modal
      data-testid="edit-alert-modal"
      opened={opened}
      onClose={onClose}
      title="Edit Alert"
      size="lg"
    >
      <form onSubmit={onSubmit}>
        <Stack gap="xs">
          <Text size="xxs" opacity={0.5}>
            Trigger
          </Text>
          <Group gap="xs">
            <Text size="sm" opacity={0.7}>
              {isTileAlert ? 'Alert when the value' : 'Alert when'}
            </Text>
            <Controller
              control={control}
              name="thresholdType"
              render={({ field }) => (
                <NativeSelect
                  data={optionsToSelectData(thresholdTypeOptions)}
                  size="xs"
                  {...field}
                  onChange={e => {
                    field.onChange(e);
                    if (
                      isRangeThresholdType(e.currentTarget.value) &&
                      thresholdMax == null
                    ) {
                      setValue('thresholdMax', (threshold ?? 0) + 1);
                    }
                  }}
                />
              )}
            />
            <Controller
              control={control}
              name="threshold"
              render={({ field }) => (
                <NumberInput size="xs" w={80} {...field} />
              )}
            />
            {isRangeThresholdType(thresholdType as AlertThresholdType) && (
              <>
                <Text size="sm" opacity={0.7}>
                  and
                </Text>
                <Controller
                  control={control}
                  name="thresholdMax"
                  render={({ field, fieldState }) => (
                    <NumberInput
                      size="xs"
                      w={80}
                      {...field}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </>
            )}
            <Text size="sm" opacity={0.7}>
              {isTileAlert ? 'over' : 'lines appear within'}
            </Text>
            <Controller
              control={control}
              name="interval"
              render={({ field }) => (
                <NativeSelect
                  data={optionsToSelectData(intervalOptions)}
                  size="xs"
                  {...field}
                />
              )}
            />
            <Text size="sm" opacity={0.7}>
              via
            </Text>
            <Controller
              control={control}
              name="channel.type"
              render={({ field }) => (
                <NativeSelect
                  data={optionsToSelectData(ALERT_CHANNEL_OPTIONS)}
                  size="xs"
                  {...field}
                />
              )}
            />
          </Group>
          <AlertScheduleFields
            control={control}
            setValue={setValue}
            scheduleOffsetName="scheduleOffsetMinutes"
            scheduleStartAtName="scheduleStartAt"
            scheduleOffsetMinutes={scheduleOffsetMinutes}
            maxScheduleOffsetMinutes={maxScheduleOffsetMinutes}
            offsetWindowLabel={`from each ${intervalLabel} window`}
            numConsecutiveWindowsName="numConsecutiveWindows"
            numConsecutiveWindows={numConsecutiveWindows ?? undefined}
          />
          {!isTileAlert && (
            <>
              <Text size="xxs" opacity={0.5} mb={4} mt="xs">
                grouped by
              </Text>
              <SQLInlineEditorControlled
                tableConnection={tcFromSource(source)}
                control={control}
                name="groupBy"
                placeholder="SQL Columns"
                disableKeywordAutocomplete
                size="xs"
              />
            </>
          )}
          <Text size="xxs" opacity={0.5} mb={4}>
            Send to
          </Text>
          <AlertChannelForm control={control} type={channelType} />
          <AlertNoteField control={control} name="note" />
          {!isTileAlert &&
            groupBy &&
            (thresholdType === AlertThresholdType.BELOW ||
              thresholdType === AlertThresholdType.BELOW_OR_EQUAL ||
              thresholdType === AlertThresholdType.EQUAL ||
              thresholdType === AlertThresholdType.NOT_EQUAL) && (
              <MantineAlert
                icon={<IconInfoCircleFilled size={16} />}
                color="gray"
                py="xs"
              >
                <Text size="sm" opacity={0.7}>
                  Warning: Alerts with this threshold type and a &quot;grouped
                  by&quot; value will not alert for periods with no data for a
                  group.
                </Text>
              </MantineAlert>
            )}
          {(thresholdType === AlertThresholdType.EQUAL ||
            thresholdType === AlertThresholdType.NOT_EQUAL) && (
            <MantineAlert
              icon={<IconInfoCircleFilled size={16} />}
              color="gray"
              py="xs"
            >
              <Text size="sm" opacity={0.7}>
                Note: Floating-point query results are not rounded during
                equality comparison.
              </Text>
            </MantineAlert>
          )}
        </Stack>
        <Group mt="lg" justify="flex-end" gap="xs">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={updateAlert.isPending}
          >
            Save Alert
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
