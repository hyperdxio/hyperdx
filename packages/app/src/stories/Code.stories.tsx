import { Code, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';

/**
 * Snippet chrome for the app and for Storybook guidelines.
 *
 * - Inline: Mantine `Code`
 * - Fenced / copyable: `CopySnippet` (`Code block` + Copy)
 *
 * Do not use raw `<pre>`, ad-hoc Paper + monospace text, or unstyled `<code>`.
 * SQL query previews still use `SQLPreview` / `ChartSQLPreview`.
 */
const meta: Meta<typeof CopySnippet> = {
  title: 'Components/Code',
  component: CopySnippet,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    label: { control: 'text' },
    snippet: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof CopySnippet>;

const FENCED_EXAMPLE = `<CopySnippet
  label="Import block"
  snippet={\`import { clickstack_dashboard } from "clickhouse/clickstack"\`}
/>`;

const INLINE_EXAMPLE = `Create a source with <Code>Session</Code> type.`;

export const Playground: Story = {
  args: {
    label: 'Import block',
    snippet:
      'import {\n  clickhouse_clickstack_dashboard.example\n} from "clickhouse/clickstack"',
  },
};

export const InlineCode = () => (
  <Stack gap="md" maw={640} p="lg">
    <div>
      <Text size="lg" fw={700}>
        Inline code
      </Text>
      <Text size="sm" c="var(--color-text-muted)">
        Short tokens in prose. Use Mantine <Code>Code</Code> — not a raw{' '}
        <Code>{'<code>'}</Code> or monospace <Code>Text</Code>.
      </Text>
    </div>
    <Text size="sm">
      Create a source with <Code>Session</Code> type, then select the{' '}
      <Code>hyperdx_sessions</Code> table.
    </Text>
    <CopySnippet snippet={INLINE_EXAMPLE} />
  </Stack>
);

export const FencedBlocks = () => (
  <Stack gap="lg" maw={640} p="lg">
    <div>
      <Text size="lg" fw={700}>
        Fenced blocks
      </Text>
      <Text size="sm" c="var(--color-text-muted)">
        Multi-line or copyable snippets. Use <Code>CopySnippet</Code> from{' '}
        <Code>@/components/ClickStackOnboarding/CopySnippet</Code>. It renders
        Mantine <Code>Code block</Code> plus a Copy button.
      </Text>
    </div>
    <CopySnippet
      label="Import block"
      snippet={`import {
  clickhouse_clickstack_dashboard.example
} from "clickhouse/clickstack"`}
    />
    <div>
      <Text size="sm" fw={600} mb="xs">
        Without a label
      </Text>
      <Text size="xs" c="var(--color-text-muted)" mb="sm">
        Omit <Code>label</Code> when a heading above already names the snippet.
      </Text>
      <CopySnippet snippet={'yarn workspace @hyperdx/app storybook'} />
    </div>
    <CopySnippet snippet={FENCED_EXAMPLE} />
  </Stack>
);

export const Usage = () => (
  <Stack gap="lg" maw={640} p="lg">
    <div>
      <Text size="lg" fw={700}>
        When to use which
      </Text>
      <Text size="sm" c="var(--color-text-muted)">
        Storybook Guidelines markdown maps fenced blocks to{' '}
        <Code>CopySnippet</Code> and inline <Code>`code`</Code> to Mantine{' '}
        <Code>Code</Code> automatically. Use the same split in app UI.
      </Text>
    </div>
    <CopySnippet label="Inline — Mantine Code" snippet={INLINE_EXAMPLE} />
    <CopySnippet
      label="Fenced — CopySnippet (Code + Copy)"
      snippet={FENCED_EXAMPLE}
    />
    <CopySnippet
      label="Do not"
      snippet={`<pre>{snippet}</pre>
<Paper bg="var(--color-bg-code)">
  <Text component="pre" ff="monospace">{snippet}</Text>
</Paper>`}
    />
    <Text size="sm" c="var(--color-text-muted)">
      SQL query previews (rendered ClickHouse SQL with highlighting) still use{' '}
      <Code>SQLPreview</Code> / <Code>ChartSQLPreview</Code> — those are
      editors, not snippet chrome.
    </Text>
  </Stack>
);
