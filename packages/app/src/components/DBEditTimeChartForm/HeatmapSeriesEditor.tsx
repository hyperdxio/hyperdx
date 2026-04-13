import { useCallback, useMemo, useState } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Flex, Portal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import type { HeatmapScaleType } from '@/components/DBHeatmapChart';
import HeatmapSettingsDrawer, {
  HeatmapSettingsValues,
} from '@/components/HeatmapSettingsDrawer';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';

type HeatmapSeriesEditorProps = {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  tableSource?: TSource;
  parentRef?: HTMLElement | null;
  onSubmit: () => void;
};

export function HeatmapSeriesEditor({
  control,
  setValue,
  tableSource,
  parentRef,
  onSubmit,
}: HeatmapSeriesEditorProps) {
  const [settingsOpened, settingsHandlers] = useDisclosure(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const valueExpression = useWatch({
    control,
    name: 'series.0.valueExpression',
  });
  const countExpression = useWatch({
    control,
    name: 'series.0.countExpression' as any,
  });

  const scaleTypeRaw = useWatch({
    control,
    name: 'series.0.heatmapScaleType' as any,
  });
  const scaleType: HeatmapScaleType = scaleTypeRaw ?? 'log';

  const connection = useMemo(() => tcFromSource(tableSource), [tableSource]);

  const handleSettingsSubmit = useCallback(
    (data: HeatmapSettingsValues) => {
      setValue('series.0.valueExpression', data.value);
      setValue('series.0.countExpression' as any, data.count || 'count()');
      onSubmit();
      settingsHandlers.close();
    },
    [setValue, onSubmit, settingsHandlers],
  );

  const handleScaleTypeChange = useCallback(
    (v: HeatmapScaleType) => {
      setValue('series.0.heatmapScaleType' as any, v);
    },
    [setValue],
  );

  return (
    <>
      <Flex direction="column" gap="sm" ref={setContainer}>
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
            onClick={settingsHandlers.open}
            size="compact-sm"
            variant="secondary"
          >
            Display Settings
          </Button>
        </Flex>
      </Flex>
      <Portal>
        <HeatmapSettingsDrawer
          opened={settingsOpened}
          onClose={settingsHandlers.close}
          connection={connection}
          parentRef={container}
          defaultValues={{
            value: valueExpression || '',
            count: countExpression || 'count()',
          }}
          scaleType={scaleType}
          onScaleTypeChange={handleScaleTypeChange}
          onSubmit={handleSettingsSubmit}
        />
      </Portal>
    </>
  );
}
