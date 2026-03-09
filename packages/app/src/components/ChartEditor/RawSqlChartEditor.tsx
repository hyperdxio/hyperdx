import { useEffect } from 'react';
import { atom, useAtom } from 'jotai';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@hyperdx/common-utils/dist/rawSqlParams';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Code,
  Collapse,
  Group,
  List,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
} from '@tabler/icons-react';

import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';

import { ConnectionSelectControlled } from '../ConnectionSelect';
import { SQLEditorControlled } from '../SQLEditor';

import { SQL_PLACEHOLDERS } from './constants';
import { ChartEditorFormState } from './types';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

function ParamSnippet({
  value,
  description,
}: {
  value: string;
  description: string;
}) {
  const clipboard = useClipboard({ timeout: 1500 });

  return (
    <Group gap={4} display="inline-flex">
      <Code fz="xs">{value}</Code>
      <Tooltip label={clipboard.copied ? 'Copied!' : 'Copy'} withArrow>
        <ActionIcon
          variant="subtle"
          size="xs"
          color={clipboard.copied ? 'green' : 'gray'}
          onClick={() => clipboard.copy(value)}
        >
          {clipboard.copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
        </ActionIcon>
      </Tooltip>
      <Text span size="xs">
        &mdash; {description}
      </Text>
    </Group>
  );
}

const helpOpenedAtom = atom(true);

function AvailableParameters({ displayType }: { displayType: DisplayType }) {
  const [helpOpened, setHelpOpened] = useAtom(helpOpenedAtom);
  const toggleHelp = () => setHelpOpened(v => !v);
  const availableParams = QUERY_PARAMS_BY_DISPLAY_TYPE[displayType];

  return (
    <Paper
      p="xs"
      radius="sm"
      style={{
        background: 'var(--color-bg-muted)',
      }}
    >
      <Stack gap={0}>
        <Group
          gap="xs"
          align="center"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={toggleHelp}
        >
          {helpOpened ? (
            <IconChevronDown size={12} />
          ) : (
            <IconChevronRight size={12} />
          )}
          <Text size="xs" mt={1}>
            Query parameters
          </Text>
        </Group>
        <Collapse in={helpOpened}>
          <Stack gap={6} pl="xs" pt="md">
            <Text size="xs">
              The following parameters can be referenced in this chart's SQL:
            </Text>
            <List size="xs" withPadding spacing={3}>
              {availableParams.map(({ name, type, description }) => (
                <List.Item key={name}>
                  <ParamSnippet
                    value={`{${name}:${type}}`}
                    description={description}
                  />
                </List.Item>
              ))}
            </List>
            <Text size="xs">Example:</Text>
            <Code fz="xs" block>
              {
                'WHERE Timestamp >= fromUnixTimestamp64Milli ({startDateMilliseconds:Int64})\n  AND Timestamp <= fromUnixTimestamp64Milli ({endDateMilliseconds:Int64})'
              }
            </Code>
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}

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
      <AvailableParameters displayType={displayType ?? DisplayType.Table} />
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
