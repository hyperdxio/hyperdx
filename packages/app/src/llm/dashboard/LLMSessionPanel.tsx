import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import SqlString from 'sqlstring';
import {
  Accordion,
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  Text,
} from '@mantine/core';

import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { TokenUsageDisplay } from '@/llm/components/TokenUsageDisplay';
import { asNumber, asString } from '@/llm/lib/attributeUtils';
import { formatCostUsd, formatTokenCount } from '@/llm/lib/extract';
import { FormatTime } from '@/useFormatTime';
import { useZIndex, ZIndexContext } from '@/zIndex';

import { baseLLMChartConfig, buildLLMSearchUrl } from './chartConfig';
import { SessionSpanDetail } from './SessionSpanDetail';
import { LLMChartProps } from './types';

import styles from '@/../styles/LogSidePanel.module.scss';

const MAX_SESSION_SPANS = 100;

/**
 * A lightweight timeline row. Sessions can carry hundreds of megabytes of
 * span attributes (agent SDKs stamp the whole conversation history on every
 * span), so the list query selects only SQL-derived scalars; the full
 * attributes are fetched per span on expand (see SessionSpanDetail).
 */
export interface SessionSpanListRow {
  ts: string;
  spanName: string;
  spanId: string;
  model?: string;
  toolName?: string;
  totalTokens?: number;
  costUsd?: number;
}

function SessionSpanItem({
  row,
  index,
  expanded,
  source,
}: {
  row: SessionSpanListRow;
  index: number;
  expanded: boolean;
  source: LLMChartProps['source'];
}) {
  return (
    <Accordion.Item value={`span-${index}`}>
      <Accordion.Control>
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            <FormatTime value={new Date(row.ts)} format="withMs" />
          </Text>
          <Text size="xs" fw={500} truncate>
            {row.spanName}
          </Text>
          {row.model != null && (
            <Badge size="xs" variant="light" color="violet" tt="none">
              {row.model}
            </Badge>
          )}
          {row.toolName != null && (
            <Badge size="xs" variant="light" color="orange" tt="none">
              {row.toolName}
            </Badge>
          )}
          {row.totalTokens != null && row.totalTokens > 0 && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {formatTokenCount(row.totalTokens)}
            </Text>
          )}
          {row.costUsd != null && row.costUsd > 0 && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {formatCostUsd(row.costUsd)}
            </Text>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        {/* Mounted only while expanded so the (potentially megabytes-large)
            attribute payload is fetched lazily, one span at a time. */}
        {expanded && <SessionSpanDetail source={source} row={row} />}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

/**
 * Session detail drawer: a chronological timeline of the session's LLM and
 * tool spans, each expandable into the normalized conversation. Opened from
 * the sessions table via the `llmSession` query param.
 */
export function LLMSessionPanel(props: LLMChartProps) {
  const { source, expressions, dateRange } = props;
  const [sessionId, setSessionId] = useQueryState('llmSession', parseAsString);
  const [, setDashboardSessionId] = useQueryState('sessionId', parseAsString);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const onClose = useCallback(() => setSessionId(null), [setSessionId]);

  // Scope the entire dashboard (all tabs) to this session and close the drawer.
  const onFilterDashboard = useCallback(() => {
    setDashboardSessionId(sessionId);
    setSessionId(null);
  }, [setDashboardSessionId, sessionId, setSessionId]);

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const sessionCondition = useMemo(
    () =>
      sessionId != null
        ? SqlString.format('? = ?', [
            SqlString.raw(expressions.sessionId),
            sessionId,
          ])
        : '0=1',
    [expressions.sessionId, sessionId],
  );

  const spansConfig = useMemo(
    () => ({
      ...baseLLMChartConfig({
        ...props,
        extraFilters: [{ type: 'sql' as const, condition: sessionCondition }],
      }),
      select: [
        {
          alias: 'ts',
          valueExpression: `toString(${source.timestampValueExpression})`,
        },
        { alias: 'spanName', valueExpression: expressions.spanName },
        { alias: 'spanId', valueExpression: source.spanIdExpression },
        { alias: 'model', valueExpression: expressions.model },
        { alias: 'toolName', valueExpression: expressions.toolName },
        { alias: 'totalTokens', valueExpression: expressions.totalTokens },
        { alias: 'costUsd', valueExpression: expressions.costUsd },
      ],
      orderBy: `${source.timestampValueExpression} ASC`,
      limit: { limit: MAX_SESSION_SPANS },
    }),
    [props, sessionCondition, source, expressions],
  );

  const { data, isLoading } = useQueriedChartConfig(spansConfig, {
    queryKey: ['llm-session-spans', spansConfig],
    enabled: sessionId != null,
  });

  // Session totals as one aggregate query (gated like the dashboard sums)
  // rather than summing the fetched rows client-side.
  const totalsConfig = useMemo(
    () => ({
      ...baseLLMChartConfig({
        ...props,
        extraFilters: [{ type: 'sql' as const, condition: sessionCondition }],
      }),
      select: [
        { aggFn: 'count' as const, valueExpression: '', alias: 'span_count' },
        {
          aggFn: 'sum' as const,
          valueExpression: expressions.totalTokens,
          alias: 'total_tokens',
          aggCondition: expressions.hasReportedTokens,
          aggConditionLanguage: 'sql' as const,
        },
        {
          aggFn: 'sum' as const,
          valueExpression: expressions.costUsd,
          alias: 'total_cost',
          aggCondition: expressions.hasReportedTokens,
          aggConditionLanguage: 'sql' as const,
        },
      ],
    }),
    [props, sessionCondition, expressions],
  );
  const { data: totalsData } = useQueriedChartConfig(totalsConfig, {
    queryKey: ['llm-session-totals', totalsConfig],
    enabled: sessionId != null,
  });
  const totals = {
    tokens: asNumber(totalsData?.data?.[0]?.total_tokens) ?? 0,
    cost: asNumber(totalsData?.data?.[0]?.total_cost) ?? 0,
    spanCount: asNumber(totalsData?.data?.[0]?.span_count) ?? 0,
  };

  const rows: SessionSpanListRow[] = useMemo(
    () =>
      (data?.data ?? []).map(row => {
        const model = asString(row.model);
        const toolName = asString(row.toolName);
        return {
          ts: String(row.ts),
          spanName: String(row.spanName ?? ''),
          spanId: String(row.spanId ?? ''),
          ...(model != null ? { model } : {}),
          ...(toolName != null ? { toolName } : {}),
          totalTokens: asNumber(row.totalTokens),
          costUsd: asNumber(row.costUsd),
        };
      }),
    [data],
  );

  if (sessionId == null) {
    return null;
  }

  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size="60vw"
      withCloseButton={false}
      zIndex={drawerZIndex}
      styles={{ body: { padding: 0 } }}
    >
      <ZIndexContext value={drawerZIndex}>
        <div className={styles.panel} data-testid="llm-session-panel">
          <DrawerHeader
            header={
              <Group gap="xs" wrap="nowrap">
                <Text size="sm" ff="monospace" truncate>
                  {sessionId}
                </Text>
                <TokenUsageDisplay
                  usage={{ totalTokens: totals.tokens }}
                  costUsd={totals.cost > 0 ? totals.cost : undefined}
                  costEstimated
                />
                <Button variant="link" size="xs" onClick={onFilterDashboard}>
                  Filter dashboard
                </Button>
                <Anchor
                  component={Link}
                  size="xs"
                  href={buildLLMSearchUrl({
                    source,
                    expressions,
                    dateRange,
                    extraConditions: [sessionCondition],
                  })}
                >
                  Open in search
                </Anchor>
              </Group>
            }
            onClose={onClose}
          />
          <DrawerBody>
            {totals.spanCount > MAX_SESSION_SPANS && (
              <Text size="xs" c="dimmed" px="md" pt="xs">
                Showing the first {MAX_SESSION_SPANS} of {totals.spanCount}{' '}
                spans.
              </Text>
            )}
            {rows.length > 0 ? (
              <Accordion
                multiple
                variant="contained"
                value={expandedItems}
                onChange={setExpandedItems}
              >
                {rows.map((row, index) => (
                  <SessionSpanItem
                    // Time-ordered list, replaced wholesale per fetch; span
                    // ids alone can repeat when a span id is reused.
                    // eslint-disable-next-line @eslint-react/no-array-index-key
                    key={`${row.spanId}-${index}`}
                    row={row}
                    index={index}
                    expanded={expandedItems.includes(`span-${index}`)}
                    source={source}
                  />
                ))}
              </Accordion>
            ) : (
              !isLoading && (
                <Text size="sm" c="dimmed" p="md">
                  No LLM spans found for this session in the selected time
                  range.
                </Text>
              )
            )}
          </DrawerBody>
        </div>
      </ZIndexContext>
    </Drawer>
  );
}
