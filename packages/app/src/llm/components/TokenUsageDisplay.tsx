import { Group, Text, Tooltip } from '@mantine/core';

import { formatCostUsd, formatTokenCount } from '@/llm/lib/extract';
import { LLMUsage } from '@/llm/lib/types';

function UsageStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" fw={500}>
        {value}
      </Text>
      {detail != null && (
        <Text size="xs" c="dimmed">
          ({detail})
        </Text>
      )}
    </Group>
  );
}

/**
 * Compact token usage + cost summary line for an LLM span. Shown in the
 * overview subpanel and the conversation panel header.
 */
export function TokenUsageDisplay({
  usage,
  costUsd,
  costEstimated,
}: {
  usage: LLMUsage;
  costUsd?: number;
  costEstimated?: boolean;
}) {
  const hasUsage =
    usage.inputTokens != null ||
    usage.outputTokens != null ||
    usage.totalTokens != null;
  if (!hasUsage && costUsd == null) {
    return null;
  }

  return (
    <Group gap="md" wrap="wrap" data-testid="llm-token-usage">
      {usage.inputTokens != null && (
        <UsageStat
          label="Input"
          value={formatTokenCount(usage.inputTokens)}
          detail={
            usage.cachedInputTokens != null && usage.cachedInputTokens > 0
              ? `${formatTokenCount(usage.cachedInputTokens)} cached`
              : undefined
          }
        />
      )}
      {usage.outputTokens != null && (
        <UsageStat
          label="Output"
          value={formatTokenCount(usage.outputTokens)}
          detail={
            usage.reasoningOutputTokens != null &&
            usage.reasoningOutputTokens > 0
              ? `${formatTokenCount(usage.reasoningOutputTokens)} reasoning`
              : undefined
          }
        />
      )}
      {usage.totalTokens != null && (
        <UsageStat label="Total" value={formatTokenCount(usage.totalTokens)} />
      )}
      {costUsd != null && (
        <Tooltip
          label={
            costEstimated
              ? 'Estimated from token usage and bundled model prices'
              : 'Cost reported by the instrumentation'
          }
          position="top"
        >
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed">
              Cost
            </Text>
            <Text size="xs" fw={500} data-testid="llm-cost">
              {costEstimated ? '~' : ''}
              {formatCostUsd(costUsd)}
            </Text>
          </Group>
        </Tooltip>
      )}
    </Group>
  );
}
