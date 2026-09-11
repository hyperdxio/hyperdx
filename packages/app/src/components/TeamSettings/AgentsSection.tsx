import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconBrandOpenai, IconPlus } from '@tabler/icons-react';

import api from '@/api';
import EmptyState from '@/components/EmptyState';
import AddAgentModal from '@/components/TeamSettings/AddAgentModal';
import { notifyError } from '@/components/TeamSettings/agentForms';
import { IS_MANAGED_AGENTS_ENABLED } from '@/config';
import { ClaudeCodeIcon, CursorAIIcon } from '@/SVGIcons';
import { useConfirm } from '@/useConfirm';

function AgentRow({
  agent,
  onDeleted,
}: {
  agent: {
    _id: string;
    name: string;
    model?: string;
    anthropicAgentId: string;
    instructions?: string;
    imported?: boolean;
    createdBy?: { name?: string; email?: string };
  };
  onDeleted: VoidFunction;
}) {
  const confirm = useConfirm();
  const deleteAgent = api.useDeleteManagedAgent();

  const handleDelete = async () => {
    if (
      await confirm(
        agent.imported ? (
          <>
            Removing {agent.name} deletes the Anthropic vault (which holds the
            ClickStack access credential) and environment HyperDX created for
            it. You wrote the agent itself, so that stays.
          </>
        ) : (
          <>
            Deleting {agent.name} also removes its Anthropic vault (which holds
            the ClickStack access credential) and environment. This is{' '}
            <b>not reversible</b>.
          </>
        ),
        agent.imported ? 'Remove' : 'Delete',
        { variant: 'danger' },
      )
    ) {
      deleteAgent.mutate(
        { id: agent._id },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: agent.imported ? 'Agent removed' : 'Agent deleted',
            });
            onDeleted();
          },
          onError: notifyError,
        },
      );
    }
  };

  return (
    <Group justify="space-between">
      <Box style={{ minWidth: 0 }}>
        <Text>{agent.name}</Text>
        <Text size="xs" c="dimmed">
          {[agent.model, agent.anthropicAgentId].filter(Boolean).join(' · ')}
          {/* The vault holds this user's ClickStack access key, so the agent
              queries with their access — worth seeing at a glance. */}
          {agent.createdBy &&
            ` · created by ${agent.createdBy.name || agent.createdBy.email}`}
        </Text>
        {agent.instructions && (
          <Text size="xs" c="dimmed" lineClamp={2} mt={2}>
            {agent.instructions}
          </Text>
        )}
      </Box>
      <Group gap="xs" wrap="nowrap">
        {agent.imported && (
          <Badge size="xs" variant="light">
            Imported
          </Badge>
        )}
        <Button
          variant="danger"
          size="xs"
          loading={deleteAgent.isPending}
          onClick={handleDelete}
        >
          {agent.imported ? 'Remove' : 'Delete'}
        </Button>
      </Group>
    </Group>
  );
}

export default function AgentsSection() {
  if (!IS_MANAGED_AGENTS_ENABLED) {
    return null;
  }
  return <AgentsSectionInner />;
}

// Providers beyond Claude are display-only placeholders until a second
// integration is real — no provider abstraction behind the tabs yet.
const COMING_SOON_PROVIDERS = [
  { name: 'Cursor', icon: <CursorAIIcon width={14} /> },
  { name: 'OpenAI Codex', icon: <IconBrandOpenai size={14} /> },
];

function AgentsSectionInner() {
  const { data: agentsData, refetch } = api.useManagedAgents();
  const [addOpened, addHandlers] = useDisclosure(false);

  const agents = agentsData?.data ?? [];
  const addButton = (
    <Button
      variant="primary"
      size="xs"
      leftSection={<IconPlus size={14} />}
      onClick={addHandlers.open}
      data-testid="add-agent"
    >
      Add agent
    </Button>
  );

  return (
    <Box id="ai-agents" data-testid="ai-agents-section" mt="xl">
      <Text size="md">AI agents</Text>
      <Text size="xs" c="dimmed" mt={4}>
        Connect a cloud AI agent that investigates alerts through the ClickStack
        MCP server. Add it to an alert as a 🤖 notification channel; each firing
        starts an investigation session, and the agent&apos;s own configuration
        decides where its findings go.
      </Text>
      <Divider my="md" />

      <Tabs value="claude" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab
            value="claude"
            data-testid="agent-provider-tab-claude"
            leftSection={<ClaudeCodeIcon width={14} />}
          >
            Claude
          </Tabs.Tab>
          {COMING_SOON_PROVIDERS.map(provider => (
            <Tabs.Tab
              key={provider.name}
              value={provider.name}
              disabled
              leftSection={provider.icon}
              rightSection={
                <Badge size="xs" variant="light" color="gray">
                  Coming soon
                </Badge>
              }
            >
              {provider.name}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="claude">
          <Card>
            {agents.length === 0 ? (
              <EmptyState description="No agents yet. Add one to use it as an alert notification channel.">
                {addButton}
              </EmptyState>
            ) : (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
                  </Text>
                  {addButton}
                </Group>
                <Divider />
                {agents.map(agent => (
                  <AgentRow key={agent._id} agent={agent} onDeleted={refetch} />
                ))}
              </Stack>
            )}
          </Card>
        </Tabs.Panel>
      </Tabs>

      <AddAgentModal
        opened={addOpened}
        onClose={addHandlers.close}
        onAdded={refetch}
      />
    </Box>
  );
}
