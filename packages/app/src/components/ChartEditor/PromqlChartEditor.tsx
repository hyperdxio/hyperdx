import { Control, useController, useWatch } from 'react-hook-form';
import { isPromqlExemplarEligible } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex, Stack, Switch, Text } from '@mantine/core';

import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { IS_EXEMPLARS_ENABLED } from '@/config';
import { usePromqlMetricNames } from '@/hooks/usePromqlMetadata';
import { useSource } from '@/source';

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
  const { field: expressionField } = useController({
    control,
    name: 'promqlExpression',
  });
  const { field: exemplarsField } = useController({
    control,
    name: 'enableExemplars',
  });

  // An exemplar marker sits at the linked trace's own duration on the chart's
  // y-axis, so the toggle only appears when the expression plots a duration too —
  // the same rule the exemplar fetch applies (isPromqlExemplarEligible). On a
  // `rate(http_requests_total[5m])` axis the markers would be clamped into a
  // requests/sec scale and read as real points on it.
  const isExemplarShape = isPromqlExemplarEligible(expressionField.value);
  const canShowExemplars = IS_EXEMPLARS_ENABLED && isExemplarShape;

  // Deliberately NOT clearing `enableExemplars` when the shape stops matching.
  // The metric editor does clear it (ChartEditorControls), but its shape is
  // derived from structural fields — display type, source kind, metric type,
  // group by. This one is derived from free text, so a clearing effect would run
  // on every keystroke: a user editing `histogram_quantile(0.95, ...)` passes
  // through transient text that isn't a histogram quantile, and the flag would be
  // switched off mid-edit and stay off once they finished retyping. Same reason
  // ChartEditorControls preserves `exemplarTraceSourceId` rather than clearing it
  // on every Group By keystroke.
  //
  // Leaving the flag set is safe: `useExemplars` gates the fetch on the same
  // eligibility rule, so an ineligible expression renders no overlay and issues
  // no query. It is inert, not broken — the same shape as a saved exemplar chart
  // opened while the deployment flag is off.

  const sourceId = useWatch({ control, name: 'source' });
  const { data: source } = useSource({ id: sourceId });
  const connectionId = source?.connection;
  const { data: metricNames } = usePromqlMetricNames(
    connectionId,
    source?.from.databaseName,
    source?.from.tableName,
  );

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
      <Flex justify="space-between" align="center" gap="sm">
        <Flex align="center" gap="sm" wrap="wrap">
          {canShowExemplars && (
            <>
              <Switch
                label="Exemplars"
                size="sm"
                color="gray"
                variant="subtle"
                checked={exemplarsField.value === true}
                onClick={() => {
                  exemplarsField.onChange(exemplarsField.value !== true);
                  onSubmit();
                }}
              />
              {exemplarsField.value === true && (
                <Flex align="center" gap={4}>
                  <Text size="xs" c="dimmed">
                    Trace source
                  </Text>
                  <SourceSelectControlled
                    size="xs"
                    control={control}
                    name="exemplarTraceSourceId"
                    allowedSourceKinds={[SourceKind.Trace]}
                  />
                </Flex>
              )}
            </>
          )}
        </Flex>
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
