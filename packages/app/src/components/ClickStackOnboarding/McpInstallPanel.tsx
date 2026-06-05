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

/**
 * Agent hosts the install panel covers. Five named installs (Claude
 * Code, Cursor, VS Code, Codex CLI, OpenCode) plus "Other" as the
 * JSON-fallback escape hatch for any other MCP-compatible host
 * (Claude Desktop, Continue, Cline, ...).
 *
 * ChatGPT is intentionally absent: native MCP isn't there yet, and
 * bridges are a user-side decision better tracked in the docs than
 * in this UI surface.
 */
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
  /**
   * Deployment shape derived from `useMe()` in the caller. The
   * caller is responsible for not mounting this panel until the
   * deployment is ready (matching the convention in
   * `ApiKeysSection`), so the type here is non-nullable.
   */
  deployment: DeploymentShape;
}

/**
 * Renders the host picker plus the install primitive (CLI command,
 * deep link, or JSON block) for the chosen host. Presentational;
 * the deployment shape comes in via props so the same component
 * can render from any surface that resolves a deployment + access
 * key.
 *
 * The access key is inlined in the rendered snippet to match the
 * existing API Keys card pattern, which shows the key in plain
 * text. A follow-up will introduce a shared mask + reveal-to-copy
 * affordance across every credential surface in Team Settings.
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
          // Narrow the SegmentedControl's `string` callback against
          // the CHOICES set so a future out-of-band value cannot
          // silently install an invalid host. CHOICES is the source
          // of truth for the option list.
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

      <HostInstall host={host} snippets={snippets} />
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
  // Exhaustiveness check via `satisfies never`: adding a new
  // AgentHost variant without extending the switch fails the
  // compile here. Defensive `return null` (instead of throwing)
  // keeps a runtime-only unknown variant from crashing the panel.
  id satisfies never;
  return null;
}

interface HostInstallProps {
  host: AgentHost;
  snippets: BuiltSnippets;
}

function HostInstall({ host, snippets }: HostInstallProps) {
  switch (host) {
    case 'claude-code':
      return (
        <CopySnippet
          label="Paste in your terminal:"
          snippet={snippets.claudeCode}
        />
      );

    case 'cursor':
      return (
        <DeeplinkInstall
          buttonLabel="Add to Cursor"
          deeplink={snippets.cursor}
          fallbackLabel="Or paste this JSON into Cursor settings > MCP:"
          fallbackSnippet={snippets.jsonBlock}
        />
      );

    case 'vscode-copilot':
      return (
        <DeeplinkInstall
          buttonLabel="Add to VS Code"
          deeplink={snippets.vscode}
          fallbackLabel="Or paste this JSON into .vscode/mcp.json:"
          fallbackSnippet={snippets.jsonBlock}
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
        />
      );

    case 'opencode':
      return (
        <CopySnippet
          label="Paste this into `opencode.json` (project) or `~/.config/opencode/config.json` (global):"
          snippet={snippets.openCode}
        />
      );

    case 'other':
      return (
        <CopySnippet
          label="Paste this into your host's MCP config:"
          snippet={snippets.jsonBlock}
        />
      );
  }
  // Exhaustiveness check via `satisfies never`: adding a new
  // AgentHost variant without extending the switch fails the
  // compile here. Defensive `return null` (instead of throwing)
  // keeps a runtime-only unknown variant from crashing the panel.
  host satisfies never;
  return null;
}
