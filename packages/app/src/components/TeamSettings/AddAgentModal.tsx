import { useState } from 'react';
import { Code, Modal, SegmentedControl, Stack, Text } from '@mantine/core';

import CreateAgentForm from '@/components/TeamSettings/CreateAgentForm';
import ImportAgentForm from '@/components/TeamSettings/ImportAgentForm';

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
  const [mode, setMode] = useState('create');

  const onDone = () => {
    onAdded();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add agent" size="lg">
      <Stack gap="md">
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
        {mode === 'create' ? (
          <CreateAgentForm onCreated={onDone} />
        ) : (
          <ImportAgentForm onImported={onDone} />
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
