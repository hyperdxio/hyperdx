import { useMemo } from 'react';
import { Control, FieldErrors, UseFormSetValue } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Flex, Stack, Text, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { EDITOR_INPUT_HEIGHTS } from '@/components/editorInputHeights';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

type HeatmapSeriesEditorProps = {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  errors: FieldErrors<ChartEditorFormState>;
  tableSource?: TSource;
  dateRange?: [Date, Date];
  parentRef: HTMLElement | null;
  onSubmit: () => void;
  onOpenDisplaySettings: () => void;
};

function InlineLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <Flex h={`${EDITOR_INPUT_HEIGHTS.sm}px`} align="center" gap={4}>
      <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Text>
      <Tooltip label={tooltip}>
        <IconHelpCircle size={16} opacity={0.5} />
      </Tooltip>
    </Flex>
  );
}

export function HeatmapSeriesEditor({
  control,
  setValue,
  errors,
  tableSource,
  dateRange,
  parentRef,
  onSubmit,
  onOpenDisplaySettings,
}: HeatmapSeriesEditorProps) {
  const connection = useMemo(() => tcFromSource(tableSource), [tableSource]);

  return (
    <Flex direction="column">
      <Stack gap="sm">
        <div
          className="gap-2"
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto 1fr',
            alignItems: 'start',
          }}
        >
          <InlineLabel
            label="Value"
            tooltip="The y axis: the value each event is bucketed by."
          />
          <div data-testid="heatmap-value-input">
            <SQLInlineEditorControlled
              parentRef={parentRef}
              tableConnection={connection}
              sourceId={tableSource?.id}
              dateRange={dateRange}
              control={control}
              name="series.0.valueExpression"
              placeholder="SQL expression, e.g. Duration"
              onSubmit={onSubmit}
              error={
                Array.isArray(errors.series)
                  ? errors.series[0]?.valueExpression?.message
                  : undefined
              }
              enableVariables
            />
          </div>
          <InlineLabel
            label="Count"
            tooltip="The color intensity: how much each bucket holds."
          />
          <div data-testid="heatmap-count-input">
            <SQLInlineEditorControlled
              parentRef={parentRef}
              tableConnection={connection}
              sourceId={tableSource?.id}
              dateRange={dateRange}
              control={control}
              name="series.0.countExpression"
              placeholder="SQL expression, e.g. count()"
              onSubmit={onSubmit}
              enableVariables
            />
          </div>
        </div>
        <SearchWhereInput
          tableConnection={connection}
          sourceId={tableSource?.id}
          dateRange={dateRange}
          control={control}
          name="where"
          onSubmit={onSubmit}
          onLanguageChange={(lang: 'sql' | 'lucene') =>
            setValue('whereLanguage', lang)
          }
          enableVariables
        />
      </Stack>
      <Divider my="sm" />
      <Flex justify="flex-end">
        <Button
          onClick={onOpenDisplaySettings}
          size="compact-sm"
          variant="secondary"
          data-testid="display-settings-button"
        >
          Display Settings
        </Button>
      </Flex>
    </Flex>
  );
}
