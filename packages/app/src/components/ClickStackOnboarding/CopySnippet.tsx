import { Button, Code, CopyButton, Group, Stack, Text } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

import { RevealSnippet } from '@/components/RevealSnippet/RevealSnippet';

interface CopySnippetProps {
  /** Optional heading above the snippet (e.g. "Import block"). */
  label?: string;
  snippet: string;
  /**
   * Access key inlined in `snippet`. When set, the snippet is masked
   * until revealed; omit for a plain, always-visible snippet.
   */
  accessKey?: string;
}

/** Pre-formatted snippet with a copy button, masked when `accessKey` is set. */
export function CopySnippet({ label, snippet, accessKey }: CopySnippetProps) {
  if (accessKey) {
    return (
      <RevealSnippet value={snippet} secrets={[accessKey]}>
        <Stack gap="xs">
          <Group justify="space-between" align="center" wrap="nowrap">
            {label ? (
              <Text size="sm" fw={500}>
                {label}
              </Text>
            ) : (
              <span />
            )}
            <Group gap="xs" wrap="nowrap">
              <RevealSnippet.Reveal />
              <RevealSnippet.Copy variant="button" />
            </Group>
          </Group>
          <RevealSnippet.Code />
        </Stack>
      </RevealSnippet>
    );
  }

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
