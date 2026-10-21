import { useState } from 'react';
import {
  type OrgApiKeyExpiry,
  OrgApiKeyExpirySchema,
  type OrgApiKeyScope,
  OrgApiKeyScopeSchema,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import { RevealSnippet } from '@/components/RevealSnippet/RevealSnippet';

const SCOPE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];

const EXPIRY_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '1y', label: '1 year' },
  { value: 'never', label: 'Never' },
];

export default function CreateOrgApiKeyModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const createKey = api.useCreateOrgApiKey();
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<OrgApiKeyScope>('member');
  const [expiry, setExpiry] = useState<OrgApiKeyExpiry>('30d');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const close = () => {
    setDescription('');
    setScope('member');
    setExpiry('30d');
    setCreatedKey(null);
    onClose();
  };

  const onCreate = () => {
    createKey.mutate(
      { description: description.trim(), scope, expiry },
      {
        onSuccess: data => setCreatedKey(data.key),
        onError: e => {
          notifications.show({
            color: 'red',
            message: e.message,
            autoClose: 5000,
          });
        },
      },
    );
  };

  return (
    <Modal opened={opened} onClose={close} title="Create API key" centered>
      {createdKey != null ? (
        <Stack>
          <Text size="sm">
            Copy this key now. You won&apos;t be able to see it again.
          </Text>
          <RevealSnippet value={createdKey} secrets={[createdKey]}>
            <RevealSnippet.Input
              aria-label="New API key"
              revealLabel="Reveal key"
              copyLabel="Copy key"
            />
          </RevealSnippet>
          <Group justify="flex-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <TextInput
            label="Description"
            value={description}
            maxLength={100}
            onChange={e => setDescription(e.currentTarget.value)}
            data-autofocus
          />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Scope
            </Text>
            <SegmentedControl
              aria-label="Scope"
              data={SCOPE_OPTIONS}
              value={scope}
              onChange={value => setScope(OrgApiKeyScopeSchema.parse(value))}
            />
            <Text size="xs" c="dimmed">
              Member keys can&apos;t manage team members or invitations.
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Expires
            </Text>
            <SegmentedControl
              aria-label="Expires"
              data={EXPIRY_OPTIONS}
              value={expiry}
              onChange={value => setExpiry(OrgApiKeyExpirySchema.parse(value))}
            />
          </Stack>
          <Group justify="flex-end">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onCreate}
              disabled={description.trim() === ''}
              loading={createKey.isPending}
            >
              Create
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
