import { Button, Code, CopyButton, Group, Stack, Text } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

interface CopySnippetProps {
  /** Optional heading above the snippet (e.g. "Import block"). */
  label?: string;
  snippet: string;
}

/**
 * Pre-formatted snippet with a copy-to-clipboard button. The copy
 * affordance handles its own `Copied` affirmation via Mantine's
 * `<CopyButton>`.
 */
export function CopySnippet({ label, snippet }: CopySnippetProps) {
  return (
    <Stack gap="xs">
      {label ? (
        <Text size="sm" fw={500}>
          {label}
        </Text>
      ) : null}
      <Group align="flex-start" w="100%" gap="xs">
        <Code
          block
          flex={1}
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontFamily: 'var(--mantine-font-family-monospace)',
          }}
        >
          {snippet}
        </Code>
        <CopyButton value={snippet}>
          {({ copied, copy }) => (
            <Button
              onClick={copy}
              variant="subtle"
              size="xs"
              leftSection={
                copied ? <IconCheck size={14} /> : <IconCopy size={14} />
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Stack>
  );
}
