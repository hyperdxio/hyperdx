import { useMemo, useState } from 'react';
import { Alert, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import {
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
 * Agent hosts the install panel covers. Five fixed options surface
 * the most common installs (Claude Code, Cursor, VS Code + Copilot,
 * Codex CLI); "Other" is the JSON-fallback escape hatch that
 * handles every other MCP-compatible host (Claude Desktop,
 * Continue, Cline, ...).
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
  | 'other';

interface HostChoice {
  id: AgentHost;
  label: string;
}

const CHOICES: HostChoice[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode-copilot', label: 'VS Code + Copilot' },
  { id: 'codex-cli', label: 'Codex CLI' },
  { id: 'other', label: 'Other' },
];

interface McpInstallPanelProps {
  /**
   * Deployment shape derived from `useMe()` + `useTeam()` in the
   * caller. Passing `null` renders a "sign in to load credentials"
   * alert.
   */
  deployment: DeploymentShape | null;
}

/**
 * Renders the host picker plus the install primitive (CLI command,
 * deep link, or JSON block) for the chosen host. Presentational;
 * the deployment shape comes in via props so the same component
 * renders from both the EE Team Settings page and the onboarding
 * `done` step in a follow-up PR.
 *
 * The access key is inlined in the rendered snippet to match the
 * existing API Keys card pattern, which shows the key in plain
 * text. A follow-up will introduce a shared mask + reveal-to-copy
 * affordance across every credential surface in Team Settings
 * (outcome AC16).
 */
export default function McpInstallPanel({ deployment }: McpInstallPanelProps) {
  const [host, setHost] = useState<AgentHost>('claude-code');

  const snippets = useMemo(
    () => (deployment ? buildAllSnippets(deployment) : null),
    [deployment],
  );

  return (
    <Stack gap="md">
      <SegmentedControl
        fullWidth
        value={host}
        onChange={value => setHost(value as AgentHost)}
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

      {!deployment ? (
        <Alert color="yellow" variant="light">
          Sign in to load your personal access key before installing.
        </Alert>
      ) : !deployment.accessKey ? (
        <Alert color="yellow" variant="light">
          No access key on this account yet. Ask an admin to create one and sign
          back in.
        </Alert>
      ) : snippets ? (
        <HostInstall host={host} snippets={snippets} />
      ) : null}
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
    case 'other':
      return <IconRobot size={16} />;
  }
  // Exhaustiveness check: adding a new AgentHost variant without
  // extending this switch fails the compile here.
  return assertNever(id);
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

    case 'other':
      return (
        <CopySnippet
          label="Paste this into your host's MCP config:"
          snippet={snippets.jsonBlock}
        />
      );
  }
  // Exhaustiveness check: adding a new AgentHost variant without
  // extending this switch fails the compile here.
  return assertNever(host);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled AgentHost variant: ${String(value)}`);
}
