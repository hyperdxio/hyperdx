import { useCallback, useEffect, useState } from 'react';
import {
  Control,
  useFieldArray,
  UseFormGetValues,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import {
  displayTypeSupportsInstantQuery,
  displayTypeSupportsReducer,
} from '@hyperdx/common-utils/dist/core/promql';
import {
  displayTypeSupportsPromQLAlerts,
  isTimeSeriesDisplayType,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  MAX_PROMQL_EXPRESSIONS,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Flex, Group, Text } from '@mantine/core';
import { IconBell, IconCirclePlus } from '@tabler/icons-react';

import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { IS_LOCAL_MODE } from '@/config';
import { usePromqlMetricNames } from '@/hooks/usePromqlMetadata';
import { useSource, useSources } from '@/source';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

import PromqlExpressionEditor from './PromqlExpressionEditor';
import { ChartEditorFormState } from './types';

export default function PromqlChartEditor({
  control,
  getValues,
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
  getValues: UseFormGetValues<ChartEditorFormState>;
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
  const {
    fields: expressions,
    append,
    insert,
    remove,
    swap,
  } = useFieldArray({
    control,
    name: 'promqlExpressions',
  });

  const duplicateExpression = useCallback(
    (index: number) => {
      insert(index + 1, {
        ...structuredClone(getValues(`promqlExpressions.${index}`)),
        alias: '',
      });
    },
    [insert, getValues],
  );

  /**
   * Indexes of the PromQL expressions whose query type controls are expanded.
   *
   * Held here rather than in each row: submitting on the chart explorer resets
   * the form, which gives useFieldArray new ids and remounts the rows.
   */
  const [openQueryTypeControlIndexes, setOpenQueryTypeControlIndexes] =
    useState<number[]>([]);
  const toggleShowQueryTypeControl = useCallback((index: number) => {
    setOpenQueryTypeControlIndexes(open =>
      open.includes(index) ? open.filter(i => i !== index) : [...open, index],
    );
  }, []);

  const sourceId = useWatch({ control, name: 'source' });
  const displayType = useWatch({ control, name: 'displayType' });
  const chartName = useWatch({ control, name: 'name' });
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

  const displayTypeSupportsMultiExpression =
    isTimeSeriesDisplayType(displayType);
  const canAddExpression =
    displayTypeSupportsMultiExpression &&
    expressions.length < MAX_PROMQL_EXPRESSIONS;

  return (
    <>
      <Group>
        <Text pe="md" size="sm">
          Data Source
        </Text>
        <SourceSelectControlled
          size="xs"
          control={control}
          name="source"
          allowedSourceKinds={[SourceKind.Promql]}
        />
      </Group>

      {expressions.map((field, index) => (
        <PromqlExpressionEditor
          key={field.id}
          control={control}
          index={index}
          length={expressions.length}
          metricNames={metricNames}
          isIgnored={!displayTypeSupportsMultiExpression && index > 0}
          isInstantQuerySupported={displayTypeSupportsInstantQuery({
            displayType,
          })}
          isReducerSupported={displayTypeSupportsReducer({ displayType })}
          isQueryTypeControlOpen={openQueryTypeControlIndexes.includes(index)}
          onToggleQueryTypeControlOpen={() => toggleShowQueryTypeControl(index)}
          onSubmit={onSubmit}
          onSwap={swap}
          onRemove={expressions.length > 1 ? remove : undefined}
          onDuplicate={canAddExpression ? duplicateExpression : undefined}
        />
      ))}
      <Divider mt="md" mb="sm" />

      <Flex mt={4} align="center" justify="space-between">
        <Group gap="xs">
          {canAddExpression && (
            <Button
              variant="subtle"
              size="sm"
              color="gray"
              onClick={() => append({ expression: '', alias: '' })}
              data-testid="promql-add-expression-button"
            >
              <IconCirclePlus size={14} className="me-2" />
              Add expression
            </Button>
          )}
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
          data-testid="display-settings-button"
        >
          Display Settings
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
          tooltip="The threshold will be evaluated against the last value returned by the last PromQL expression"
        />
      )}
    </>
  );
}
