import { useState } from 'react';
import {
  AGENT_TOOLSET,
  AUTO_ALLOWED_MCP_TOOLS,
} from '@hyperdx/common-utils/dist/managedAgents';
import {
  Box,
  Button,
  Code,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';
import { notifyError } from '@/components/TeamSettings/agentForms';
import { BASE_PATH } from '@/config';

// Creates only the agent object: the environment and vault are provisioned on
// import, so the copied text never contains a ClickStack access key. The
// payload is assembled with `jq -n` rather than inlined into one -d argument so
// every line stays short enough to read in the dialog without wrapping.
//
// Both toolset configs come from the same constants the API provisions with,
// because nothing inspects or rewrites an imported agent's toolset — whatever
// this snippet creates is what runs unattended.
const buildManualSetupScript = (mcpUrl: string) =>
  `# Creates the agent and prints its ID. Edit SYSTEM to change how it works.
export ANTHROPIC_API_KEY="sk-ant-..."
MCP_URL="${mcpUrl}"

SYSTEM='You are an SRE agent. Investigate the ClickStack alert via the
clickstack MCP server and produce a root-cause summary.
Do not make changes to production systems.'

READ_TOOLS='${JSON.stringify(AUTO_ALLOWED_MCP_TOOLS)}'
BUILTIN_TOOLS='${JSON.stringify(AGENT_TOOLSET)}'

jq -n --arg system "$SYSTEM" --arg url "$MCP_URL" \\
  --argjson read "$READ_TOOLS" --argjson builtin "$BUILTIN_TOOLS" '{
  name: "ClickStack SRE Responder",
  model: "claude-opus-4-8",
  system: $system,
  mcp_servers: [{ type: "url", name: "clickstack", url: $url }],
  tools: [
    $builtin,
    {
      type: "mcp_toolset",
      mcp_server_name: "clickstack",
      default_config: { permission_policy: { type: "always_ask" } },
      configs: [$read[] | { name: ., permission_policy: { type: "always_allow" } }]
    }
  ]
}' | curl -s https://api.anthropic.com/v1/agents \\
  -H "x-api-key: $ANTHROPIC_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "anthropic-beta: managed-agents-2026-04-01" \\
  -H "content-type: application/json" \\
  -d @- | jq -r .id`;

// Links an agent someone wrote themselves. Only its ID is asked for — the
// supporting environment and vault are provisioned here, so the credential is
// guaranteed to match this instance rather than being a thing to get wrong.
export default function ImportAgentForm({
  onImported,
}: {
  onImported: VoidFunction;
}) {
  const importAgent = api.useImportManagedAgent();
  const [name, setName] = useState('');
  const [anthropicAgentId, setAnthropicAgentId] = useState('');
  const [showScript, setShowScript] = useState(false);
  const origin = globalThis.location?.origin ?? '';

  const onImport = () => {
    importAgent.mutate(
      {
        ...(name.trim() ? { name: name.trim() } : {}),
        anthropicAgentId: anthropicAgentId.trim(),
      },
      {
        onSuccess: ({ data, verified }) => {
          notifications.show({
            color: verified ? 'green' : 'yellow',
            message: verified
              ? `Agent "${data.name}" imported`
              : `Agent "${data.name}" imported, but HyperDX could not confirm it with Anthropic — check the ID if alerts don't reach it.`,
          });
          onImported();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Stack gap="sm">
      {/* No `description` on either input: a description on one column and not
          the other, or one that wraps, pushes the inputs to different heights. */}
      <Group gap="xs" grow align="start">
        <TextInput
          label="Anthropic agent ID"
          placeholder="agent_..."
          value={anthropicAgentId}
          onChange={e => setAnthropicAgentId(e.currentTarget.value)}
        />
        <TextInput
          label="Name (optional)"
          placeholder="Defaults to its name on Anthropic"
          value={name}
          onChange={e => setName(e.currentTarget.value)}
        />
      </Group>
      <Text size="xs" c="dimmed">
        The ID is in the create response, or on the agent&apos;s page in the
        Claude console. Its model comes from the agent itself, which is also
        what a session runs. HyperDX creates the environment and vault it needs
        so the credential matches this instance; removing it later deletes those
        two and leaves your agent on Anthropic.
      </Text>
      <Group justify="space-between">
        <Button
          variant="subtle"
          size="xs"
          onClick={() => setShowScript(o => !o)}
        >
          {showScript ? 'Hide commands' : "Don't have one?"}
        </Button>
        <Button
          variant="primary"
          disabled={!anthropicAgentId.trim()}
          loading={importAgent.isPending}
          onClick={onImport}
        >
          Import agent
        </Button>
      </Group>
      {showScript && (
        <Box>
          {/* Above the snippet: both caveats matter before it is copied, and
              the prefilled MCP_URL is a localhost one in development. */}
          <Text size="xs" c="dimmed" mb="xs">
            Requires jq. Anthropic&apos;s sandbox reaches <Code>MCP_URL</Code>{' '}
            directly, so it has to be public HTTPS — replace it if you&apos;re
            running locally. The tool policy matters: nothing is watching to
            approve anything, so only read-only ClickStack tools are
            auto-approved, there is no shell, and fetching a runbook link is
            evaluated per call.
          </Text>
          <CopySnippet
            snippet={buildManualSetupScript(`${origin}${BASE_PATH}/api/mcp`)}
          />
        </Box>
      )}
    </Stack>
  );
}
