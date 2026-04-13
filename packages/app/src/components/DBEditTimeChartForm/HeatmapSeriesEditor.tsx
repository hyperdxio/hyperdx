import { useMemo } from 'react';
import { Control, UseFormSetValue } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Flex } from '@mantine/core';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';

type HeatmapSeriesEditorProps = {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  tableSource?: TSource;
  onSubmit: () => void;
  onOpenDisplaySettings: () => void;
};

export function HeatmapSeriesEditor({
  control,
  setValue,
  tableSource,
  onSubmit,
  onOpenDisplaySettings,
}: HeatmapSeriesEditorProps) {
  const connection = useMemo(() => tcFromSource(tableSource), [tableSource]);

  return (
    <Flex direction="column" gap="sm">
      <SearchWhereInput
        tableConnection={connection}
        control={control}
        name="where"
        onSubmit={onSubmit}
        onLanguageChange={(lang: 'sql' | 'lucene') =>
          setValue('whereLanguage', lang)
        }
        showLabel={false}
      />
      <Divider />
      <Flex justify="flex-end">
        <Button
          onClick={onOpenDisplaySettings}
          size="compact-sm"
          variant="secondary"
        >
          Display Settings
        </Button>
      </Flex>
    </Flex>
  );
}
