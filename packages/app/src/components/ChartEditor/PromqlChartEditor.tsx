import { Control, useController, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Stack, Text } from '@mantine/core';

import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { usePromqlMetricNames } from '@/hooks/usePromqlMetadata';
import { useSource } from '@/source';

import { ChartEditorFormState } from './types';

export default function PromqlChartEditor({
  control,
  onSubmit,
}: {
  control: Control<ChartEditorFormState>;
  onSubmit: (suppressErrorNotification?: boolean) => void;
}) {
  const { field: expressionField } = useController({
    control,
    name: 'promqlExpression',
  });

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
    </Stack>
  );
}
