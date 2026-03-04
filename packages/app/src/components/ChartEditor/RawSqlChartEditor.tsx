import { Control } from 'react-hook-form';
import { Box, Button, Group, Stack, Text } from '@mantine/core';

import useResizable from '@/hooks/useResizable';

import { ConnectionSelectControlled } from '../ConnectionSelect';
import { SQLEditorControlled } from '../SQLEditor';

import { ChartEditorFormState } from './types';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

export default function RawSqlChartEditor({
  control,
  onOpenDisplaySettings,
}: {
  control: Control<ChartEditorFormState>;
  onOpenDisplaySettings: () => void;
}) {
  const { size, startResize } = useResizable(20, 'bottom');

  return (
    <Stack>
      <Group mb="md" align="center">
        <Text pe="md" size="sm">
          Connection
        </Text>
        <ConnectionSelectControlled
          control={control}
          name="connection"
          size="xs"
        />
      </Group>
      <Box style={{ position: 'relative' }}>
        <SQLEditorControlled
          control={control}
          name="sqlTemplate"
          height={`${size}vh`}
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
