import { useMemo } from 'react';
import { Badge } from '@clickhouse/click-ui';
import { Group, Stack, Table, Text } from '@mantine/core';

import { IS_LLM_COST_ENABLED } from '@/config';
import { resolveSpanCostUsd } from '@/llm/lib/cost';
import { LLMSpanInfo } from '@/llm/lib/types';

import { TokenUsageDisplay } from './TokenUsageDisplay';

/**
 * Compact LLM summary for the span Overview tab: model/provider badges,
 * token usage + cost, and request parameters. The conversation itself lives
 * in the dedicated LLM tab.
 */
export function LLMSpanSubpanel({ info }: { info: LLMSpanInfo }) {
  const { costUsd, estimated } = useMemo(
    () =>
      IS_LLM_COST_ENABLED
        ? resolveSpanCostUsd(info)
        : { costUsd: undefined, estimated: false },
    [info],
  );

  const paramEntries = Object.entries(info.params);

  return (
    <Stack gap="sm" data-testid="llm-span-subpanel">
      <Group gap="xs" wrap="wrap">
        {info.model != null && <Badge text={info.model} state="info" />}
        {info.provider != null && (
          <Badge text={info.provider} state="neutral" />
        )}
        {info.operation != null && <Badge text={info.operation} />}
        {info.toolName != null && (
          <Badge text={info.toolName} state="warning" />
        )}
        {info.agentName != null && (
          <Badge text={info.agentName} state="success" />
        )}
      </Group>

      <TokenUsageDisplay
        usage={info.usage}
        costUsd={costUsd}
        costEstimated={estimated}
      />

      {(paramEntries.length > 0 ||
        info.finishReasons != null ||
        info.timeToFirstTokenMs != null ||
        info.conversationId != null) && (
        <Table
          withRowBorders={false}
          verticalSpacing={2}
          horizontalSpacing="xs"
          fz="xs"
          w="auto"
        >
          <Table.Tbody>
            {info.requestModel != null &&
              info.responseModel != null &&
              info.requestModel !== info.responseModel && (
                <Table.Tr>
                  <Table.Td c="dimmed">Requested model</Table.Td>
                  <Table.Td>{info.requestModel}</Table.Td>
                </Table.Tr>
              )}
            {paramEntries.map(([key, value]) => (
              <Table.Tr key={key}>
                <Table.Td c="dimmed">{key}</Table.Td>
                <Table.Td>{value}</Table.Td>
              </Table.Tr>
            ))}
            {info.finishReasons != null && (
              <Table.Tr>
                <Table.Td c="dimmed">Finish reasons</Table.Td>
                <Table.Td>{info.finishReasons}</Table.Td>
              </Table.Tr>
            )}
            {info.timeToFirstTokenMs != null && (
              <Table.Tr>
                <Table.Td c="dimmed">Time to first token</Table.Td>
                <Table.Td>{Math.round(info.timeToFirstTokenMs)}ms</Table.Td>
              </Table.Tr>
            )}
            {info.conversationId != null && (
              <Table.Tr>
                <Table.Td c="dimmed">Conversation</Table.Td>
                <Table.Td>
                  <Text span size="xs" ff="monospace">
                    {info.conversationId}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
