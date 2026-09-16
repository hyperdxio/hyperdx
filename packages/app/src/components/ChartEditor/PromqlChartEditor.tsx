import { Control, useFieldArray, useWatch } from 'react-hook-form';
import { isTimeSeriesDisplayType } from '@hyperdx/common-utils/dist/core/utils';
import {
  DisplayType,
  MAX_PROMQL_EXPRESSIONS,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex, Stack, Text } from '@mantine/core';
import { IconCirclePlus } from '@tabler/icons-react';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { usePromqlMetricNames } from '@/hooks/usePromqlMetadata';
import { useSource } from '@/source';

import PromqlExpressionEditor from './PromqlExpressionEditor';
import { ChartEditorFormState } from './types';

export default function PromqlChartEditor({
  control,
  onSubmit,
  onOpenDisplaySettings,
}: {
  control: Control<ChartEditorFormState>;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  onOpenDisplaySettings: () => void;
}) {
  const { fields, append, remove, swap } = useFieldArray({
    control,
    name: 'promqlExpressions',
  });

  const sourceId = useWatch({ control, name: 'source' });
  const displayType = useWatch({ control, name: 'displayType' });
  const chartLegendTemplate = useWatch({ control, name: 'legendTemplate' });
  const { data: source } = useSource({ id: sourceId });
  // The form can still hold a non-PromQL source right after switching a tile
  // into PromQL mode (the picker above only restricts future selections), and
  // the metric-name lookup reads a TimeSeries engine table, so it would fail
  // against any other source's table.
  const promqlSource = source?.kind === SourceKind.Promql ? source : undefined;
  const { data: metricNames } = usePromqlMetricNames(
    promqlSource?.connection,
    promqlSource?.from.databaseName,
    promqlSource?.from.tableName,
  );

  // Several result sets only make sense on a time series; the other display
  // types plot the first expression and ignore the rest.
  const plotsEveryExpression = isTimeSeriesDisplayType(displayType);

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
      {fields.map((field, index) => (
        <PromqlExpressionEditor
          key={field.id}
          control={control}
          index={index}
          length={fields.length}
          metricNames={metricNames}
          // Number tiles show a single value, so they have no legend to name
          // (mirrors the display settings drawer's chart-level template).
          showLegendTemplate={displayType !== DisplayType.Number}
          chartLegendTemplate={chartLegendTemplate?.trim() || undefined}
          isIgnored={!plotsEveryExpression && index > 0}
          onSubmit={onSubmit}
          onSwap={swap}
          onRemove={remove}
        />
      ))}
      <Flex justify="space-between">
        {plotsEveryExpression && fields.length < MAX_PROMQL_EXPRESSIONS ? (
          <Button
            variant="subtle"
            size="sm"
            onClick={() =>
              append({ expression: '', alias: '', legendTemplate: '' })
            }
            data-testid="promql-add-expression-button"
          >
            <IconCirclePlus size={14} className="me-2" />
            Add expression
          </Button>
        ) : (
          <Box />
        )}
        <Button
          onClick={onOpenDisplaySettings}
          size="compact-sm"
          variant="secondary"
        >
          Display Settings
        </Button>
      </Flex>
    </Stack>
  );
}
