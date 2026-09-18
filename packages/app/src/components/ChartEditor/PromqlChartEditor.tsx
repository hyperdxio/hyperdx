import { Control, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Button, Flex, Group, Stack, Text } from '@mantine/core';

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
  const sourceId = useWatch({ control, name: 'source' });
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

  return (
    <Stack gap="sm">
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
      <PromqlExpressionEditor
        control={control}
        metricNames={metricNames}
        onSubmit={onSubmit}
      />
      <Flex justify="end">
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
