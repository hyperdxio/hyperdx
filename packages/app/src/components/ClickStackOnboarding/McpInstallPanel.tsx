import { useMemo, useState } from 'react';
import { Group, SegmentedControl, Stack, Text } from '@mantine/core';
import {
  IconBraces,
  IconBrandOpenai,
  IconBrandVisualStudio,
  IconCode,
  IconRobot,
  IconTerminal2,
} from '@tabler/icons-react';

import { CopySnippet } from './CopySnippet';
import { DeeplinkInstall } from './DeeplinkInstall';
import {
  buildAllSnippets,
  type BuiltSnippets,
  type DeploymentShape,
} from './installSnippets';

// ChatGPT is intentionally absent: no native MCP yet, and bridges are a
// user-side decision better tracked in docs than in this UI.
type AgentHost =
  | 'claude-code'
  | 'cursor'
  | 'vscode-copilot'
  | 'codex-cli'
  | 'opencode'
  | 'other';

interface HostChoice {
  id: AgentHost;
  label: string;
}

const CHOICES: HostChoice[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode-copilot', label: 'VS Code' },
  { id: 'codex-cli', label: 'Codex CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'other', label: 'Other' },
];

const HOST_IDS = new Set<string>(CHOICES.map(c => c.id));

function isAgentHost(value: string): value is AgentHost {
  return HOST_IDS.has(value);
}

interface McpInstallPanelProps {
  /** Non-nullable: the caller mounts this only once the deployment is ready. */
  deployment: DeploymentShape;
}

/**
 * Host picker plus the install primitive (CLI command, deep link, or JSON
 * block) for the chosen host. The access key is masked in every snippet.
 */
export default function McpInstallPanel({ deployment }: McpInstallPanelProps) {
  const [host, setHost] = useState<AgentHost>('claude-code');

  const snippets = useMemo(() => buildAllSnippets(deployment), [deployment]);

  return (
    <Stack gap="md">
      <SegmentedControl
        fullWidth
        value={host}
        onChange={value => {
          // Narrow the string callback so an out-of-band value can't set an
          // invalid host.
          if (isAgentHost(value)) {
            setHost(value);
          }
        }}
        data={CHOICES.map(c => ({
          value: c.id,
          label: (
            <Group gap="xs" justify="center" wrap="nowrap">
              <HostIcon id={c.id} />
              <Text size="sm">{c.label}</Text>
            </Group>
          ),
        }))}
        aria-label="MCP host"
      />

      <HostInstall
        host={host}
        snippets={snippets}
        accessKey={deployment.accessKey}
      />
    </Stack>
  );
}

function HostIcon({ id }: { id: AgentHost }) {
  switch (id) {
    case 'claude-code':
      return <IconTerminal2 size={16} />;
    case 'cursor':
      return <IconCode size={16} />;
    case 'vscode-copilot':
      return <IconBrandVisualStudio size={16} />;
    case 'codex-cli':
      return <IconBrandOpenai size={16} />;
    case 'opencode':
      return <IconBraces size={16} />;
    case 'other':
      return <IconRobot size={16} />;
  }
  // Exhaustiveness: a new AgentHost variant fails compile here. `return null`
  // keeps a runtime-only unknown variant from crashing the panel.
  id satisfies never;
  return null;
}

interface HostInstallProps {
  host: AgentHost;
  snippets: BuiltSnippets;
  /** Access key masked in every snippet; empty when there's no key. */
  accessKey: string;
}

function HostInstall({ host, snippets, accessKey }: HostInstallProps) {
  switch (host) {
    case 'claude-code':
      return (
        <CopySnippet
          label="Paste in your terminal:"
          snippet={snippets.claudeCode}
          accessKey={accessKey}
        />
      );

    case 'cursor':
      return (
        <DeeplinkInstall
          buttonLabel="Add to Cursor"
          deeplink={snippets.cursor}
          fallbackLabel="Or paste this JSON into Cursor settings > MCP:"
          fallbackSnippet={snippets.jsonBlock}
          fallbackAccessKey={accessKey}
        />
      );

    case 'vscode-copilot':
      return (
        <DeeplinkInstall
          buttonLabel="Add to VS Code"
          deeplink={snippets.vscode}
          fallbackLabel="Or paste this JSON into .vscode/mcp.json:"
          fallbackSnippet={snippets.jsonBlock}
          fallbackAccessKey={accessKey}
          note={
            <Text size="xs" c="dimmed">
              Requires VS Code 1.99+ with the Copilot Chat MCP feature enabled.
            </Text>
          }
        />
      );

    case 'codex-cli':
      return (
        <CopySnippet
          label="Paste in your terminal:"
          snippet={snippets.codexCli}
          accessKey={accessKey}
        />
      );

    case 'opencode':
      return (
        <CopySnippet
          label="Paste this into `opencode.json` (project) or `~/.config/opencode/config.json` (global):"
          snippet={snippets.openCode}
          accessKey={accessKey}
        />
      );

    case 'other':
      return (
        <CopySnippet
          label="Paste this into your host's MCP config:"
          snippet={snippets.jsonBlock}
          accessKey={accessKey}
        />
      );
  }
  // Exhaustiveness: a new AgentHost variant fails compile here. `return null`
  // keeps a runtime-only unknown variant from crashing the panel.
  host satisfies never;
  return null;
}
