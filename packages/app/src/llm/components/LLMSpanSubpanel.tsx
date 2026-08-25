import { useMemo } from 'react';
import { Badge, Group, Stack, Table, Text } from '@mantine/core';

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
    () => resolveSpanCostUsd(info),
    [info],
  );

  const paramEntries = Object.entries(info.params);

  return (
    <Stack gap="sm" data-testid="llm-span-subpanel">
      <Group gap="xs" wrap="wrap">
        {info.model != null && (
          <Badge size="sm" variant="light" color="violet" tt="none">
            {info.model}
          </Badge>
        )}
        {info.provider != null && (
          <Badge size="sm" variant="light" color="gray" tt="none">
            {info.provider}
          </Badge>
        )}
        {info.operation != null && (
          <Badge size="sm" variant="light" color="blue" tt="none">
            {info.operation}
          </Badge>
        )}
        {info.toolName != null && (
          <Badge size="sm" variant="light" color="orange" tt="none">
            {info.toolName}
          </Badge>
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
