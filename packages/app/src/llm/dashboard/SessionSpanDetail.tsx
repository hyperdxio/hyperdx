import { useMemo } from 'react';
import SqlString from 'sqlstring';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Loader, Stack, Text } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { ChatMessageItem } from '@/llm/components/ChatMessageItem';
import { LLMSpanSubpanel } from '@/llm/components/LLMSpanSubpanel';
import { isRecord } from '@/llm/lib/attributeUtils';
import { extractLLMSpanInfo } from '@/llm/lib/extract';
import { extractConversation } from '@/llm/lib/messages';

import { SessionSpanListRow } from './LLMSessionPanel';

/**
 * Expanded detail for one session-timeline span. Fetches that single span's
 * attribute map on demand — agent SDKs stamp the full conversation history
 * on every span (hundreds of KiB each), so eagerly selecting attributes for
 * the whole timeline would ship tens of MiB to the browser.
 */
export function SessionSpanDetail({
  source,
  row,
  dateRange,
}: {
  source: TTraceSource;
  row: SessionSpanListRow;
  dateRange: [Date, Date];
}) {
  const attributeField = source.eventAttributesExpression || 'SpanAttributes';

  const config = useMemo(
    () => ({
      source: source.id,
      timestampValueExpression: source.timestampValueExpression,
      connection: source.connection,
      from: source.from,
      select: [{ alias: 'attributes', valueExpression: attributeField }],
      // Span ids can collide (or be empty) across traces, so pin the lookup
      // to the trace id from the session list as well.
      where: SqlString.format(
        '? = ? AND ? = ? AND ? = parseDateTime64BestEffort(?, 9)',
        [
          SqlString.raw(source.traceIdExpression),
          row.traceId,
          SqlString.raw(source.spanIdExpression),
          row.spanId,
          SqlString.raw(source.timestampValueExpression),
          row.ts,
        ],
      ),
      whereLanguage: 'sql' as const,
      // Bound the point lookup to the searched window for partition pruning.
      dateRange,
      limit: { limit: 1 },
    }),
    [source, attributeField, row.traceId, row.spanId, row.ts, dateRange],
  );

  const { data, isLoading } = useQueriedChartConfig(config, {
    queryKey: ['llm-session-span-detail', config],
  });

  const attributes = data?.data?.[0]?.attributes;
  const { info, conversation } = useMemo(() => {
    if (!isRecord(attributes)) {
      return { info: undefined, conversation: undefined };
    }
    return {
      info: extractLLMSpanInfo(attributes),
      conversation: extractConversation(attributes),
    };
  }, [attributes]);

  if (isLoading) {
    return <Loader size="xs" />;
  }

  return (
    <Stack gap="xs">
      {/* Some instrumentations (e.g. Claude Code) never capture message
          content; the span's LLM summary still shows usage, params, TTFT. */}
      {info != null && <LLMSpanSubpanel info={info} />}
      {conversation != null ? (
        conversation.messages.map(message => (
          <ChatMessageItem key={message.id} message={message} />
        ))
      ) : (
        <Text size="xs" c="dimmed">
          No captured messages on this span. Prompt and completion capture may
          be disabled in the instrumentation.
        </Text>
      )}
    </Stack>
  );
}
