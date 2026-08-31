import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge, Box, Code, Group, Paper, Text } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconTool,
} from '@tabler/icons-react';

import { ChatToolCall, ConversationMessage } from '@/llm/lib/types';

// Categorical role → badge color. Chat roles are categories, not statuses,
// so plain Mantine palette colors are appropriate here.
const ROLE_COLORS: Record<string, string> = {
  system: 'gray',
  developer: 'gray',
  user: 'blue',
  assistant: 'green',
  tool: 'orange',
  function: 'orange',
};

function tryPrettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function ToolCallBlock({ toolCall }: { toolCall: ChatToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const hasArguments = toolCall.arguments != null && toolCall.arguments !== '';
  return (
    <Box my={4} data-testid="llm-tool-call">
      <Group
        gap={4}
        wrap="nowrap"
        role={hasArguments ? 'button' : undefined}
        style={{ cursor: hasArguments ? 'pointer' : undefined }}
        onClick={hasArguments ? () => setExpanded(v => !v) : undefined}
      >
        {hasArguments &&
          (expanded ? (
            <IconChevronDown size={12} />
          ) : (
            <IconChevronRight size={12} />
          ))}
        <IconTool size={12} />
        <Text size="xs" fw={500} ff="monospace">
          {toolCall.name}
        </Text>
        {toolCall.id != null && (
          <Text size="xs" c="dimmed" ff="monospace">
            {toolCall.id}
          </Text>
        )}
      </Group>
      {expanded && hasArguments && (
        <Code block fz="xs" mt={4}>
          {tryPrettyJson(toolCall.arguments ?? '')}
        </Code>
      )}
    </Box>
  );
}

/**
 * One normalized chat message: role badge, markdown-rendered content, and
 * collapsible tool-call blocks.
 */
export function ChatMessageItem({ message }: { message: ConversationMessage }) {
  const role = message.role.toLowerCase();
  return (
    <Paper withBorder p="sm" radius="md" data-testid="llm-chat-message">
      <Group gap="xs" mb={message.content != null ? 6 : 0}>
        <Badge
          size="xs"
          variant="light"
          color={ROLE_COLORS[role] ?? 'gray'}
          data-testid="llm-chat-message-role"
        >
          {role}
        </Badge>
        {message.name != null && (
          <Text size="xs" c="dimmed" ff="monospace">
            {message.name}
          </Text>
        )}
      </Group>
      {message.content != null && (
        <Box className="hdx-markdown" fz="xs" style={{ overflowX: 'auto' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </Box>
      )}
      {message.toolCalls?.map((toolCall, i) => (
        <ToolCallBlock
          key={toolCall.id ?? `${toolCall.name}-${i}`}
          toolCall={toolCall}
        />
      ))}
    </Paper>
  );
}
