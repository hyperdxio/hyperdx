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
            {(displayType === DisplayType.Line ||
              displayType === DisplayType.StackedBar) && (
              <>
                <Text size="xs" fw="bold">
                  Result columns are plotted as follows:
                </Text>
                <List size="xs" withPadding spacing={3} mb="xs">
                  <List.Item>
                    <Text span size="xs" fw={600}>
                      Timestamp
                    </Text>
                    <Text span size="xs">
                      {' '}
                      — The first <Code fz="xs">Date</Code> or{' '}
                      <Code fz="xs">DateTime</Code> column.
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text span size="xs" fw={600}>
                      Series Value
                    </Text>
                    <Text span size="xs">
                      {' '}
                      — Each numeric column will be plotted as a separate
                      series. These columns are generally aggregate function
                      values.
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text span size="xs" fw={600}>
                      Group Names
                    </Text>
                    <Text span size="xs">
                      {' '}
                      (optional) — Any string, map, or array type result column
                      will be treated as a group column. Result rows with
                      different group column values will be plotted as separate
                      series.
                    </Text>
                  </List.Item>
                </List>
              </>
            )}

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
            <Code fz="xs" block>
              {QUERY_PARAM_EXAMPLES[displayType]}
            </Code>
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}
