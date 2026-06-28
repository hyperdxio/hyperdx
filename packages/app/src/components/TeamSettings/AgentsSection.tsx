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

function AnthropicKeyCard() {
  const { data: key, refetch } = api.useAnthropicKey();
  const saveKey = api.useSaveAnthropicKey();
  const deleteKey = api.useDeleteAnthropicKey();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const onSave = () => {
    saveKey.mutate(
      { apiKey: value },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: 'Anthropic API key saved',
          });
          setValue('');
          setEditing(false);
          refetch();
        },
        onError: notifyError,
      },
    );
  };

  const onRemove = () => {
    deleteKey.mutate(undefined, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message: 'Anthropic API key removed',
        });
        refetch();
      },
      onError: notifyError,
    });
  };

  const showInput = editing || !key?.exists;

  return (
    <Card mb="md">
      <Text mb="md">Anthropic API Key</Text>
      <Text size="xs" c="dimmed" mb="md">
        Stored encrypted at rest. Used to provision agents on the Anthropic
        platform; it is never sent to your alert destinations.
      </Text>
      {showInput ? (
        <Group gap="xs" align="end">
          <TextInput
            style={{ flex: 1 }}
            label={key?.exists ? 'Replace key' : 'API key'}
            placeholder="sk-ant-..."
            type="password"
            value={value}
            onChange={e => setValue(e.currentTarget.value)}
          />
          <Button
            variant="primary"
            disabled={!value.trim()}
            loading={saveKey.isPending}
            onClick={onSave}
          >
            Save
          </Button>
          {key?.exists && (
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </Group>
      ) : (
        <Group gap="xs">
          <Text ff="monospace">••••••••{key?.keyHint}</Text>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button
            variant="danger"
            loading={deleteKey.isPending}
            onClick={onRemove}
          >
            Remove
          </Button>
        </Group>
      )}
    </Card>
  );
}

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
  const { data: keyData } = api.useAnthropicKey();
  const { data: agentsData, refetch } = api.useManagedAgents();
  const deleteAgent = api.useDeleteManagedAgent();

  const hasKey = !!keyData?.exists;
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

      <AnthropicKeyCard />

      <Card>
        <Text mb="md">ClickStack SRE Agent</Text>
        {!hasKey ? (
          <Text size="sm" c="dimmed">
            Set your Anthropic API key above to create an agent.
          </Text>
        ) : (
          <Stack>
            <CreateAgentForm disabled={!hasKey} />
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
        )}
      </Card>

      <ManualSetupCard />
    </Box>
  );
}
