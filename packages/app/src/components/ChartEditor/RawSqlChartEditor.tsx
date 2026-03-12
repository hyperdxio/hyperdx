import { useEffect } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Stack, Text } from '@mantine/core';

import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';

import { ConnectionSelectControlled } from '../ConnectionSelect';

import { SQL_PLACEHOLDERS } from './constants';
import { RawSqlChartInstructions } from './RawSqlChartInstructions';
import { ChartEditorFormState } from './types';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

export default function RawSqlChartEditor({
  control,
  setValue,
  onOpenDisplaySettings,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  onOpenDisplaySettings: () => void;
}) {
  const { size, startResize } = useResizable(20, 'bottom');

  const { data: sources } = useSources();

  const displayType = useWatch({ control, name: 'displayType' });
  const connection = useWatch({ control, name: 'connection' });
  const source = useWatch({ control, name: 'source' });

  // Set a default connection
  useEffect(() => {
    if (sources && !connection) {
      const defaultConnection =
        sources.find(s => s.id === source)?.connection ??
        sources[0]?.connection;
      if (defaultConnection && defaultConnection !== connection) {
        setValue('connection', defaultConnection);
      }
    }
  }, [connection, setValue, source, sources]);

  const placeholderSQl = SQL_PLACEHOLDERS[displayType ?? DisplayType.Table];

  return (
    <Stack>
      <Group align="center">
        <Text pe="md" size="sm">
          Connection
        </Text>
        <ConnectionSelectControlled
          control={control}
          name="connection"
          size="xs"
        />
      </Group>
      <RawSqlChartInstructions displayType={displayType ?? DisplayType.Table} />
      <Box style={{ position: 'relative' }}>
        <SQLEditorControlled
          control={control}
          name="sqlTemplate"
          height={`${size}vh`}
          enableLineWrapping
          placeholder={placeholderSQl}
        />
        <div className={resizeStyles.resizeYHandle} onMouseDown={startResize} />
      </Box>
      <Group justify="flex-end">
        <Button
          onClick={onOpenDisplaySettings}
          size="compact-sm"
          variant="secondary"
        >
          Display Settings
        </Button>
      </Group>
    </Stack>
  );
}
