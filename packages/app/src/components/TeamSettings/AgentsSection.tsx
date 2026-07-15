import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import { IS_MANAGED_AGENTS_ENABLED } from '@/config';

// A copy-paste script that provisions the same agent the wizard does, but with
// the Anthropic key staying on the user's machine (nothing stored on HyperDX).
const buildManualSetupScript = (mcpUrl: string, accessKey: string) =>
  `# Manual ClickStack SRE agent setup — your Anthropic key never touches HyperDX.
# Needs: jq, and a PUBLIC HTTPS MCP URL (Anthropic's sandbox reaches it directly).
export ANTHROPIC_API_KEY="sk-ant-..."   # your Anthropic API key

H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

curl -s "\${H[@]}" https://api.anthropic.com/v1/environments \\
  -d '{"name":"clickstack-sre","config":{"type":"cloud","networking":{"type":"unrestricted"}}}'

VAULT=$(curl -s "\${H[@]}" https://api.anthropic.com/v1/vaults \\
  -d '{"display_name":"ClickStack"}' | jq -r .id)

curl -s "\${H[@]}" "https://api.anthropic.com/v1/vaults/$VAULT/credentials" \\
  -d '{"display_name":"ClickStack","auth":{"type":"static_bearer","mcp_server_url":"${mcpUrl}","token":"${accessKey}"}}'

curl -s "\${H[@]}" https://api.anthropic.com/v1/agents \\
  -d '{"name":"ClickStack SRE Responder","model":"claude-opus-4-8","system":"You are an SRE agent. Investigate the ClickStack alert via the clickstack MCP server and post a root-cause summary.","mcp_servers":[{"type":"url","name":"clickstack","url":"${mcpUrl}"}],"tools":[{"type":"agent_toolset_20260401"},{"type":"mcp_toolset","mcp_server_name":"clickstack"}]}'`;

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const notifyError = (e: { message?: string }) =>
  notifications.show({
    color: 'red',
    message: e.message || 'Something went wrong',
    autoClose: 5000,
  });

function CreateAgentForm({ disabled }: { disabled: boolean }) {
  const createAgent = api.useCreateManagedAgent();
  const { refetch } = api.useManagedAgents();
  const [name, setName] = useState('ClickStack SRE Responder');
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);

  const onCreate = () => {
    createAgent.mutate(
      { name, model },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: 'Agent created' });
          refetch();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Group gap="xs" align="end">
      <TextInput
        label="Name"
        style={{ flex: 1 }}
        value={name}
        onChange={e => setName(e.currentTarget.value)}
      />
      <Select
        label="Model"
        data={MODEL_OPTIONS}
        value={model}
        onChange={v => v && setModel(v)}
        allowDeselect={false}
      />
      <Button
        variant="primary"
        disabled={disabled || !name.trim()}
        loading={createAgent.isPending}
        onClick={onCreate}
      >
        Create Agent
      </Button>
    </Group>
  );
}

function ManualSetupCard() {
  const { data: me } = api.useMe();
  const [opened, setOpened] = useState(false);
  const origin = globalThis.location?.origin ?? '';
  const script = buildManualSetupScript(
    `${origin}/api/mcp`,
    me?.accessKey ?? '<CLICKSTACK_ACCESS_KEY>',
  );

  return (
    <Card mt="md">
      <Group justify="space-between" wrap="nowrap">
        <Box>
          <Text>Prefer not to store an API key?</Text>
          <Text size="xs" c="dimmed">
            Run these commands to create the agent yourself — your Anthropic key
            never leaves your machine.
          </Text>
        </Box>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setOpened(o => !o)}
        >
          {opened ? 'Hide' : 'Show'} commands
        </Button>
      </Group>
      {opened && (
        <>
          <Group justify="end" mt="sm">
            <CopyButton value={script}>
              {({ copied, copy }) => (
                <Button variant="secondary" size="xs" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Code block style={{ whiteSpace: 'pre', overflowX: 'auto' }}>
            {script}
          </Code>
          <Text size="xs" c="dimmed" mt="xs">
            The MCP URL must be public HTTPS (Anthropic&apos;s sandbox reaches
            it directly); replace it if you&apos;re running locally.
          </Text>
        </>
      )}
    </Card>
  );
}

export default function AgentsSection() {
  if (!IS_MANAGED_AGENTS_ENABLED) {
    return null;
  }
  return <AgentsSectionInner />;
}

function AgentsSectionInner() {
  const { data: agentsData, refetch } = api.useManagedAgents();
  const deleteAgent = api.useDeleteManagedAgent();

  const agents = agentsData?.data ?? [];

  const onDelete = (id: string) => {
    deleteAgent.mutate(
      { id },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: 'Agent deleted' });
          refetch();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Box id="managed-agents" data-testid="managed-agents-section">
      <Text size="md">Managed Agents</Text>
      <Text size="xs" c="dimmed" mt={4}>
        Provision a Claude Managed Agent that investigates ClickStack alerts via
        the ClickStack MCP server.
      </Text>
      <Divider my="md" />

      <Card>
        <Text mb="md">ClickStack SRE Agent</Text>
        <Text size="xs" c="dimmed" mb="md">
          The Anthropic API key is read from the server environment (
          <Code>AI_API_KEY</Code> with <Code>AI_PROVIDER=anthropic</Code>, or
          the legacy <Code>ANTHROPIC_API_KEY</Code>). Set it on the deployment
          to provision agents; creating an agent fails with a clear error if it
          is missing.
        </Text>
        <Stack>
          <CreateAgentForm disabled={false} />
          {agents.length > 0 && <Divider my="xs" />}
          {agents.map(agent => (
            <Group key={agent._id} justify="space-between">
              <Box>
                <Text>{agent.name}</Text>
                <Text size="xs" c="dimmed">
                  {agent.model} · {agent.anthropicAgentId}
                </Text>
              </Box>
              <Button
                variant="danger"
                size="xs"
                onClick={() => onDelete(agent._id)}
              >
                Delete
              </Button>
            </Group>
          ))}
        </Stack>
      </Card>

      <ManualSetupCard />
    </Box>
  );
}
