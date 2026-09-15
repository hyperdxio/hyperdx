import { useEffect } from 'react';
import {
  Control,
  useController,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { displayTypeSupportsPromQLAlerts } from '@hyperdx/common-utils/dist/core/utils';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex, Group, Stack, Text } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';

import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { IS_LOCAL_MODE } from '@/config';
import { usePromqlMetricNames } from '@/hooks/usePromqlMetadata';
import { useSource, useSources } from '@/source';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

import { ChartEditorFormState } from './types';

export default function PromqlChartEditor({
  control,
  onSubmit,
  onOpenDisplaySettings,
  alert,
  alertsEnabled,
  isAlertRequired,
  dashboardId,
  setValue,
  additionalAlertWarnings,
}: {
  control: Control<ChartEditorFormState>;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  onOpenDisplaySettings: () => void;
  setValue: UseFormSetValue<ChartEditorFormState>;
  alert?: ChartEditorFormState['alert'];
  /** Whether this editor offers an alert. */
  alertsEnabled?: boolean;
  /** Hides the alert editor's remove control for surfaces that require an alert. */
  isAlertRequired?: boolean;
  dashboardId?: string;
  additionalAlertWarnings?: string[];
}) {
  const { field: expressionField } = useController({
    control,
    name: 'promqlExpression',
  });

  const sourceId = useWatch({ control, name: 'source' });
  const { data: source } = useSource({ id: sourceId });
  const { data: sources } = useSources();

  useEffect(() => {
    if (!sourceId && sources) {
      const firstPromqlSource = sources.find(s => s.kind === SourceKind.Promql);
      if (firstPromqlSource) {
        setValue('source', firstPromqlSource.id);
      }
    }
  }, [sourceId, sources, setValue]);

  // The form can still hold a non-PromQL source right after switching a tile
  // into PromQL mode (the picker above only restricts future selections), and
  // the metric-name lookup reads a TimeSeries engine table, so it would fail
  // against any other source's table.
  const promqlSource = source?.kind === SourceKind.Promql ? source : undefined;

  const tableName = promqlSource?.from.tableName;

  const { data: metricNames } = usePromqlMetricNames(
    promqlSource?.connection,
    promqlSource?.from.databaseName,
    tableName,
  );

  const chartName = useWatch({ control, name: 'name' });
  const displayType = useWatch({ control, name: 'displayType' });

  return (
    <Stack gap="sm">
      <Box>
        <Text size="sm" mb={4}>
          Data Source
        </Text>
        <SourceSelectControlled
          size="xs"
          control={control}
          name="source"
          allowedSourceKinds={[SourceKind.Promql]}
        />
      </Box>
      <Box>
        <Text size="sm" mb={4}>
          PromQL Expression
        </Text>
        <PromQLEditor
          value={expressionField.value ?? ''}
          onChange={expressionField.onChange}
          onSubmit={() => onSubmit()}
          placeholder="rate(http_requests_total{service='api'}[5m])"
          metricNames={metricNames}
        />
      </Box>
      <Flex justify="space-between" align="center">
        <Group gap="xs">
          {alertsEnabled &&
            !alert &&
            !IS_LOCAL_MODE &&
            displayTypeSupportsPromQLAlerts(displayType) && (
              <Button
                variant="subtle"
                data-testid="alert-button"
                size="sm"
                onClick={() =>
                  setValue('alert', {
                    ...DEFAULT_TILE_ALERT,
                    ...(chartName && { displayName: chartName }),
                  })
                }
              >
                <IconBell size={14} className="me-2" />
                Add alert
              </Button>
            )}
        </Group>
        <Button
          onClick={onOpenDisplaySettings}
          size="compact-sm"
          variant="secondary"
        >
          Display settings
        </Button>
      </Flex>
      {alert && (
        <TileAlertEditor
          control={control}
          setValue={setValue}
          alert={alert}
          dashboardId={dashboardId}
          onRemove={
            isAlertRequired ? undefined : () => setValue('alert', undefined)
          }
          warning={
            additionalAlertWarnings?.length
              ? additionalAlertWarnings.join(' ')
              : undefined
          }
          tooltip="The threshold will be evaluated against the last value returned by the PromQL expression"
        />
      )}
    </Stack>
  );
}
