import { useState } from 'react';
import { Code, Modal, SegmentedControl, Stack, Text } from '@mantine/core';

import CreateAgentForm from '@/components/TeamSettings/CreateAgentForm';
import ImportAgentForm from '@/components/TeamSettings/ImportAgentForm';
import { IS_MANAGED_AGENT_CREATE_ENABLED } from '@/config';

// Creating and importing produce the same thing — an agent HyperDX can target —
// so they are two routes in one dialog rather than two forms competing for the
// page.
export default function AddAgentModal({
  opened,
  onClose,
  onAdded,
}: {
  opened: boolean;
  onClose: VoidFunction;
  onAdded: VoidFunction;
}) {
  // Provisioning is separately gated, so a deployment can allow importing an
  // agent without allowing one to be created. With create off there is only
  // one route, and a picker with a single option is noise.
  const [mode, setMode] = useState(
    IS_MANAGED_AGENT_CREATE_ENABLED ? 'create' : 'import',
  );

  const onDone = () => {
    onAdded();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add agent" size="lg">
      <Stack gap="md">
        {IS_MANAGED_AGENT_CREATE_ENABLED && (
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={setMode}
            data={[
              { value: 'create', label: 'Create new' },
              { value: 'import', label: 'Import existing' },
            ]}
            data-testid="add-agent-mode"
          />
        )}
        {mode === 'create' ? (
          <CreateAgentForm onCreated={onDone} />
        ) : (
          <ImportAgentForm onImported={onDone} />
        )}
        {!IS_MANAGED_AGENT_CREATE_ENABLED && (
          <Text size="xs" c="dimmed">
            Creating agents is disabled on this deployment, so an agent has to
            be created on Anthropic and imported here.
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Needs an Anthropic key on the server: <Code>AI_API_KEY</Code> with{' '}
          <Code>AI_PROVIDER=anthropic</Code>, or the legacy{' '}
          <Code>ANTHROPIC_API_KEY</Code>.
        </Text>
      </Stack>
    </Modal>
  );
}
