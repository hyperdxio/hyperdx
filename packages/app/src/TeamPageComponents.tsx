import React from 'react';
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';

export const ConfirmRotateAPIKeyModal = ({
  opened,
  onClose,
  onConfirm,
}: {
  opened: boolean;
  onClose: VoidFunction;
  onConfirm: VoidFunction;
}) => (
  <Modal
    onClose={onClose}
    opened={opened}
    title="Rotate API Key"
    keepMounted={false}
  >
    <Text size="sm" c="gray.4">
      Rotating the API key will invalidate your existing API key and generate a
      new one for you. This action is not reversible.
    </Text>
    <Group mt="md" justify="flex-end" gap="xs">
      <Button variant="default" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="light" color="red" onClick={onConfirm}>
        Confirm
      </Button>
    </Group>
  </Modal>
);

export const AddSlackWebhookModal = ({
  opened,
  onClose,
  onSubmit = () => {},
}: {
  opened: boolean;
  onClose: VoidFunction;
  onSubmit?: (arg0: {
    name: string;
    description?: string;
    url: string;
  }) => void;
}) => {
  const form = useForm<{
    name: string;
    url: string;
    description?: string;
  }>({
    mode: 'uncontrolled',
    validate: {
      name: value => (value.trim().length > 0 ? null : 'Name is required'),
      url: value => (value.startsWith('http') ? null : 'Invalid URL'),
    },
  });

  React.useEffect(() => {
    form.reset();
  }, [opened]);

  return (
    <Modal
      onClose={onClose}
      opened={opened}
      size="lg"
      title="Add Slack Incoming Webhook"
      keepMounted={false}
    >
      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Webhook Name"
            required
            placeholder="My Slack Webhook"
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Webhook URL"
            required
            placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
            {...form.getInputProps('url')}
          />
          <TextInput
            label="Webhook Description "
            placeholder="A description of this webhook (optional)"
            {...form.getInputProps('description')}
          />
        </Stack>
        <Group mt="lg" justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="light" type="submit">
            Add
          </Button>
        </Group>
      </form>
    </Modal>
  );
};

export const ConfirmDeleteTeamMember = ({
  email,
  opened,
  onClose,
  onConfirm,
}: {
  email?: string | null;
  opened: boolean;
  onClose: VoidFunction;
  onConfirm: VoidFunction;
}) => (
  <Modal
    onClose={onClose}
    opened={opened}
    title="Delete Team Member"
    keepMounted={false}
  >
    <Text size="sm" c="gray.4">
      Deleting this team member {email && <strong>({email})</strong>} will
      revoke their access to the team&apos;s resources and services. This action
      is not reversible.
    </Text>
    <Group mt="md" justify="flex-end" gap="xs">
      <Button variant="default" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="light" color="red" onClick={onConfirm}>
        Confirm
      </Button>
    </Group>
  </Modal>
);
