import { Control, useController } from 'react-hook-form';
import { Box, Text } from '@mantine/core';

import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';

import { ChartSeriesControls } from './ChartSeriesControls';
import PromqlQueryTypeControls from './PromqlQueryTypeControls';
import { ChartEditorFormState } from './types';

export default function PromqlExpressionEditor({
  control,
  index,
  length,
  metricNames,
  isIgnored,
  isInstantQuerySupported,
  isReducerSupported,
  isQueryTypeControlOpen,
  onToggleQueryTypeControlOpen,
  onSubmit,
  onSwap,
  onRemove,
  onDuplicate,
}: {
  control: Control<ChartEditorFormState>;
  index: number;
  length: number;
  metricNames: string[] | undefined;
  /** Whether the display type leaves this expression unqueried. */
  isIgnored: boolean;
  /** Whether the display type lets this expression choose between instant and range queries. */
  isInstantQuerySupported: boolean;
  /** Whether the user can specify a reducer for this expression; Requires isInstantQuerySupported: true. */
  isReducerSupported: boolean;
  isQueryTypeControlOpen: boolean;
  onToggleQueryTypeControlOpen: () => void;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  onSwap: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  onDuplicate?: (index: number) => void;
}) {
  const { field: expressionField } = useController({
    control,
    name: `promqlExpressions.${index}.expression`,
  });

  return (
    <Box>
      <ChartSeriesControls
        control={control}
        aliasName={`promqlExpressions.${index}.alias`}
        aliasPlaceholder="Expression alias"
        index={index}
        length={length}
        onSubmit={onSubmit}
        onSwap={onSwap}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
      />
      <Box mt="xs">
        <PromQLEditor
          value={expressionField.value ?? ''}
          onChange={expressionField.onChange}
          onSubmit={() => onSubmit()}
          placeholder="rate(http_requests_total{service='api'}[5m])"
          metricNames={metricNames}
        />
      </Box>
      {isIgnored ? (
        <Text size="xxs" c="dimmed" mt={4}>
          Not queried — only time series charts plot more than one expression.
        </Text>
      ) : (
        isInstantQuerySupported && (
          <PromqlQueryTypeControls
            control={control}
            index={index}
            isReducerSupported={isReducerSupported}
            isOpen={isQueryTypeControlOpen}
            onToggle={onToggleQueryTypeControlOpen}
            onSubmit={onSubmit}
          />
        )
      )}
    </Box>
  );
}
