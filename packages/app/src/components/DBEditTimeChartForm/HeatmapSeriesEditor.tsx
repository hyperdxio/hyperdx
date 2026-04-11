import { Control, UseFormSetValue } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Flex, Text } from '@mantine/core';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

type HeatmapSeriesEditorProps = {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  tableConnection: TableConnection;
  tableSource?: TSource;
  parentRef?: HTMLElement | null;
  onSubmit: () => void;
};

export function HeatmapSeriesEditor({
  control,
  setValue,
  tableConnection,
  parentRef,
  onSubmit,
}: HeatmapSeriesEditorProps) {
  return (
    <Flex direction="column" gap="sm">
      <div
        className="gap-2 align-items-center"
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
        }}
      >
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          Value
        </Text>
        <SQLInlineEditorControlled
          parentRef={parentRef}
          tableConnection={tableConnection}
          control={control}
          name="series.0.valueExpression"
          placeholder="Y-axis expression (e.g. Duration)"
          tooltipText="Expression for the Y-axis of the heatmap. Each row's value is bucketed into a cell."
          onSubmit={onSubmit}
        />
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          Count
        </Text>
        <SQLInlineEditorControlled
          parentRef={parentRef}
          tableConnection={tableConnection}
          control={control}
          name="series.0.countExpression"
          placeholder="count() (default)"
          tooltipText="Expression for cell intensity. Defaults to count() if left empty."
          onSubmit={onSubmit}
        />
        <Text size="sm">Where</Text>
        <SearchWhereInput
          tableConnection={tableConnection}
          control={control}
          name="where"
          onSubmit={onSubmit}
          onLanguageChange={(lang: 'sql' | 'lucene') =>
            setValue('whereLanguage', lang)
          }
          showLabel={false}
        />
      </div>
    </Flex>
  );
}
