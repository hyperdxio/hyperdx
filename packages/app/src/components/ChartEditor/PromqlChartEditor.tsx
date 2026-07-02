import { Control, useController, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex, Stack, Switch, Text } from '@mantine/core';

import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';
import { SourceSelectControlled } from '@/components/SourceSelect';
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
