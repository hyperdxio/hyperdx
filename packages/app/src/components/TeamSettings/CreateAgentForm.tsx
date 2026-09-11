import { useState } from 'react';
import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import {
  MODEL_OPTIONS,
  notifyError,
} from '@/components/TeamSettings/agentForms';
import {
  AGENT_PRESETS,
  DEFAULT_AGENT_PRESET,
} from '@/components/TeamSettings/agentPresets';

export default function CreateAgentForm({
  onCreated,
}: {
  onCreated: VoidFunction;
}) {
  const createAgent = api.useCreateManagedAgent();
  const [name, setName] = useState('ClickStack SRE Responder');
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);
  const [presetValue, setPresetValue] = useState(DEFAULT_AGENT_PRESET.value);
  const preset =
    AGENT_PRESETS.find(p => p.value === presetValue) ?? DEFAULT_AGENT_PRESET;

  const onCreate = () => {
    createAgent.mutate(
      { name, model, instructions: preset.instructions || undefined },
      {
        onSuccess: agent => {
          notifications.show({
            color: 'green',
            message: `Agent "${agent.data.name}" created`,
          });
          onCreated();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Stack gap="sm">
      <TextInput
        label="Name"
        value={name}
        onChange={e => setName(e.currentTarget.value)}
      />
      {/* No `description` on either Select: a description on one column and
          not the other pushes the inputs to different heights. */}
      <Group gap="xs" grow align="start">
        <Select
          label="Type"
          data={AGENT_PRESETS.map(({ value, label }) => ({ value, label }))}
          value={presetValue}
          onChange={v => v && setPresetValue(v)}
          allowDeselect={false}
          data-testid="agent-preset"
        />
        <Select
          label="Model"
          data={MODEL_OPTIONS}
          value={model}
          onChange={v => v && setModel(v)}
          allowDeselect={false}
        />
      </Group>
      {preset.instructions && (
        // Shown rather than hidden: this text is appended to the agent's
        // standing prompt, so it should not be a surprise after creation.
        <Text size="xs" c="dimmed" data-testid="agent-preset-brief">
          {preset.instructions}
        </Text>
      )}
      <Group justify="end">
        <Button
          variant="primary"
          disabled={!name.trim()}
          loading={createAgent.isPending}
          onClick={onCreate}
        >
          Create agent
        </Button>
      </Group>
    </Stack>
  );
}
