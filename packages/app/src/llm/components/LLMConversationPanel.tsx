import { useMemo } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Box, Divider, Group, Stack, Text } from '@mantine/core';

import { useRowData } from '@/components/DBRowDataPanel';
import { WithClause } from '@/hooks/useRowWhere';
import { getLLMRowData } from '@/llm/lib/rowData';

import { ChatMessageItem } from './ChatMessageItem';
import { LLMSpanSubpanel } from './LLMSpanSubpanel';

type DateRangeProps = Parameters<typeof useRowData>[0];

/**
 * The "LLM" span tab: normalized conversation (chat messages, tool calls)
 * with a usage/cost summary header. Fetches its own row data, mirroring
 * RowOverviewPanel, so integration call sites stay one-liners.
 */
export function LLMConversationPanel({
  source,
  rowId,
  aliasWith,
  dateRange,
  flush = false,
  'data-testid': dataTestId = 'llm-conversation-panel',
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  dateRange?: DateRangeProps['dateRange'];
  // When true, drop the horizontal padding so content aligns flush with
  // surrounding chrome (e.g. the tab bar in the trace span detail panel).
  flush?: boolean;
  'data-testid'?: string;
}) {
  const { data, isLoading } = useRowData({
    source,
    rowId,
    aliasWith,
    dateRange,
  });

  const firstRow = data?.data?.[0];
  const { info, conversation } = useMemo(
    () => getLLMRowData(source, firstRow),
    [source, firstRow],
  );

  return (
    <Box
      className="flex-grow-1 overflow-auto"
      px={flush ? 'xs' : 'md'}
      py="sm"
      data-testid={dataTestId}
    >
      {info != null && (
        <>
          <LLMSpanSubpanel info={info} />
          <Divider my="sm" />
        </>
      )}
      {conversation != null ? (
        <Stack gap="xs">
          {conversation.messages.map(message => (
            <ChatMessageItem key={message.id} message={message} />
          ))}
          <Group justify="flex-end">
            <Text size="xs" c="dimmed">
              Parsed from {conversation.dialect} instrumentation
            </Text>
          </Group>
        </Stack>
      ) : (
        !isLoading && (
          <Text size="sm" c="dimmed">
            No LLM messages found on this span. Prompt and completion capture
            may be disabled in the instrumentation.
          </Text>
        )
      )}
    </Box>
  );
}
