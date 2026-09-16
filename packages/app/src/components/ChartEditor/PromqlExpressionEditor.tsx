import { Control, useController } from 'react-hook-form';
import { ActionIcon, Box, Button, Divider, Group, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';

import { TextInputControlled } from '@/components/InputControlled';
import PromQLEditor from '@/components/PromQLEditor/PromQLEditor';
import { validateLegendTemplateInput } from '@/utils/legendTemplate';

import { ChartEditorFormState } from './types';

export default function PromqlExpressionEditor({
  control,
  index,
  length,
  metricNames,
  showLegendTemplate,
  chartLegendTemplate,
  isIgnored,
  onSubmit,
  onSwap,
  onRemove,
}: {
  control: Control<ChartEditorFormState>;
  index: number;
  length: number;
  metricNames: string[] | undefined;
  showLegendTemplate: boolean;
  /** The chart-level template an expression falls back to, if it has one. */
  chartLegendTemplate: string | undefined;
  /** Whether the display type leaves this expression unqueried. */
  isIgnored: boolean;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  onSwap: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const { field: expressionField } = useController({
    control,
    name: `promqlExpressions.${index}.expression`,
  });

  return (
    <Box>
      <Divider
        mb="xs"
        label={
          <Group gap="xs">
            <Text size="xxs">
              {length > 1 ? `Expression ${index + 1}` : 'PromQL Expression'}
            </Text>
            <Text size="xxs">Alias</Text>
            <div style={{ width: 150 }}>
              <TextInputControlled
                name={`promqlExpressions.${index}.alias`}
                control={control}
                placeholder="Expression alias"
                size="xs"
                data-testid="promql-alias-input"
              />
            </div>
            {index > 0 && (
              <ActionIcon
                variant="subtle"
                size="xs"
                onClick={() => onSwap(index, index - 1)}
                aria-label="Move expression up"
              >
                <IconArrowUp size={14} />
              </ActionIcon>
            )}
            {index < length - 1 && (
              <ActionIcon
                variant="subtle"
                size="xs"
                onClick={() => onSwap(index, index + 1)}
                aria-label="Move expression down"
              >
                <IconArrowDown size={14} />
              </ActionIcon>
            )}
            {length > 1 && (
              <Button
                variant="subtle"
                size="xs"
                onClick={() => onRemove(index)}
                data-testid="promql-remove-expression-button"
              >
                <IconTrash size={14} className="me-2" />
                Remove expression
              </Button>
            )}
          </Group>
        }
        labelPosition="left"
      />
      <PromQLEditor
        value={expressionField.value ?? ''}
        onChange={expressionField.onChange}
        onSubmit={() => onSubmit()}
        placeholder="rate(http_requests_total{service='api'}[5m])"
        metricNames={metricNames}
      />
      {isIgnored && (
        <Text size="xxs" c="dimmed" mt={4}>
          Not queried — only time series charts plot more than one expression.
        </Text>
      )}
      {showLegendTemplate && (
        <Group gap="xs" mt="xs" align="center">
          <Text size="xxs">Legend</Text>
          <Box style={{ flexGrow: 1 }}>
            <TextInputControlled
              name={`promqlExpressions.${index}.legendTemplate`}
              control={control}
              size="xs"
              placeholder={
                chartLegendTemplate
                  ? `Default: ${chartLegendTemplate}`
                  : 'e.g. {{namespace}} - {{pod}}'
              }
              data-testid="promql-legend-template-input"
              rules={{ validate: validateLegendTemplateInput }}
            />
          </Box>
        </Group>
      )}
    </Box>
  );
}
