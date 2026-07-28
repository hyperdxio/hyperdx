import { atom, useAtom } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import {
  QUERY_PARAM_EXAMPLES,
  QUERY_PARAMS_BY_DISPLAY_TYPE,
} from '@hyperdx/common-utils/dist/rawSqlParams';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
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

import { useDisplayTypeInstructions } from './constants';

const helpOpenedAtom = atom(true);

function ParamSnippet({
  value,
  description,
}: {
  value: string;
  description: string;
}) {
  const { t } = useTranslation('charts');
  const clipboard = useClipboard({ timeout: 1500 });

  return (
    <Group gap={4} display="inline-flex">
      <Code fz="xs">{value}</Code>
      <Tooltip
        label={clipboard.copied ? t('common.copied') : t('common.copy')}
        withArrow
      >
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
  const { t } = useTranslation('charts');
  const [helpOpened, setHelpOpened] = useAtom(helpOpenedAtom);
  const toggleHelp = () => setHelpOpened(v => !v);
  const availableParams = QUERY_PARAMS_BY_DISPLAY_TYPE[displayType];
  const exampleClipboard = useClipboard({ timeout: 1500 });
  const displayTypeInstructions = useDisplayTypeInstructions();

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
            {t('editor.instructionsTitle')}
          </Text>
        </Group>
        <Collapse expanded={helpOpened}>
          <Stack gap={6} pl="xs" pt="md">
            {displayTypeInstructions[displayType]}

            <Text size="xs" fw="bold">
              {t('editor.parametersHint')}
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
              <List.Item>
                <ParamSnippet
                  value={`$__sourceTable([metricType])`}
                  description={t('editor.sourceTableDescription')}
                />
              </List.Item>
              <List.Item>
                <ParamSnippet
                  value={`$__filters`}
                  description={t('editor.filtersDescription')}
                />
              </List.Item>
              <List.Item>
                <Text size="xs">
                  <Trans
                    t={t}
                    i18nKey="editor.otherMacros"
                    components={{
                      docLink: (
                        <Anchor
                          href="https://clickhouse.com/docs/use-cases/observability/clickstack/dashboards/sql-visualizations"
                          target="_blank"
                        />
                      ),
                    }}
                  />
                </Text>
              </List.Item>
            </List>

            <Text size="xs" fw="bold">
              {t('editor.example')}
            </Text>
            <div style={{ position: 'relative' }}>
              <Tooltip
                label={
                  exampleClipboard.copied
                    ? t('common.copied')
                    : t('common.copy')
                }
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
