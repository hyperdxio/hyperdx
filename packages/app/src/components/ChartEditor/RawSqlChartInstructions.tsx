import { atom, useAtom } from 'jotai';
import { QUERY_PARAM_EXAMPLES } from '@hyperdx/common-utils/dist/rawSqlParams';
import { ChartVariable, DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Code,
  Collapse,
  Group,
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
import { RawSqlVariableInstructions } from './RawSqlVariableInstructions';

const helpOpenedAtom = atom(true);

export function RawSqlChartInstructions({
  displayType,
  variables,
}: {
  displayType: DisplayType;
  variables?: ChartVariable[];
}) {
  const [helpOpened, setHelpOpened] = useAtom(helpOpenedAtom);
  const toggleHelp = () => setHelpOpened(v => !v);
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
        <Collapse expanded={helpOpened}>
          <Stack gap={6} pl="xs" pt="md">
            {DISPLAY_TYPE_INSTRUCTIONS[displayType]}

            <Text size="xs" fw="bold">
              Query parameters and macros
            </Text>
            <Text size="xs">
              This chart may use query parameters or macros to reference
              dashboard context. Use editor autocomplete to see available
              options, or see the{' '}
              <Anchor
                href="https://clickhouse.com/docs/use-cases/observability/clickstack/dashboards/sql-visualizations"
                target="_blank"
              >
                ClickStack documentation
              </Anchor>{' '}
              for an exhaustive list.
            </Text>

            <RawSqlVariableInstructions variables={variables} />

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
