import { Control, useController } from 'react-hook-form';
import { Box, Text } from '@mantine/core';

import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';

import { ChartEditorFormState } from './types';

export default function PromqlExpressionEditor({
  control,
  metricNames,
  onSubmit,
}: {
  control: Control<ChartEditorFormState>;
  metricNames: string[] | undefined;
  onSubmit: (suppressErrorNotification?: boolean) => void;
}) {
  const { field: expressionField } = useController({
    control,
    name: 'promqlExpression',
  });

  return (
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
  );
}
