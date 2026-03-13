import { atom, useAtom } from 'jotai';
import {
  QUERY_PARAM_EXAMPLES,
  QUERY_PARAMS_BY_DISPLAY_TYPE,
} from '@hyperdx/common-utils/dist/rawSqlParams';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
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

import { DISPLAY_TYPE_INSTRUCTIONS } from './constants';

const helpOpenedAtom = atom(true);

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

export function RawSqlChartInstructions({
  displayType,
}: {
  displayType: DisplayType;
}) {
  const [helpOpened, setHelpOpened] = useAtom(helpOpenedAtom);
  const toggleHelp = () => setHelpOpened(v => !v);
  const availableParams = QUERY_PARAMS_BY_DISPLAY_TYPE[displayType];
  const exampleClipboard = useClipboard({ timeout: 1500 });

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
            SQL Chart Instructions
          </Text>
        </Group>
        <Collapse in={helpOpened}>
          <Stack gap={6} pl="xs" pt="md">
            {DISPLAY_TYPE_INSTRUCTIONS[displayType]}

            <Text size="xs" fw="bold">
              The following parameters can be referenced in this chart's SQL:
            </Text>
            <List size="xs" withPadding spacing={3} mb="xs">
              {availableParams.map(({ name, type, description }) => (
                <List.Item key={name}>
                  <ParamSnippet
                    value={`{${name}:${type}}`}
                    description={description}
                  />
                </List.Item>
              ))}
            </List>

            <Text size="xs" fw="bold">
              Example:
            </Text>
            <div style={{ position: 'relative' }}>
              <Tooltip
                label={exampleClipboard.copied ? 'Copied!' : 'Copy'}
                withArrow
              >
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  color={exampleClipboard.copied ? 'green' : 'gray'}
                  onClick={() =>
                    exampleClipboard.copy(QUERY_PARAM_EXAMPLES[displayType])
                  }
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    zIndex: 1,
                  }}
                >
                  {exampleClipboard.copied ? (
                    <IconCheck size={10} />
                  ) : (
                    <IconCopy size={10} />
                  )}
                </ActionIcon>
              </Tooltip>
              <Code fz="xs" block>
                {QUERY_PARAM_EXAMPLES[displayType]}
              </Code>
            </div>
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}
