import { useState } from 'react';
import {
  type OrgApiKeyExpiry,
  OrgApiKeyExpirySchema,
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
  const [expiry, setExpiry] = useState<OrgApiKeyExpiry>('30d');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  // Closing mid-request would let the late response reopen on the old key.
  const close = () => {
    if (createKey.isPending) {
      return;
    }
    setDescription('');
    setExpiry('30d');
    setCreatedKey(null);
    onClose();
  };

  const onCreate = () => {
    createKey.mutate(
      { description: description.trim(), expiry },
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
            <Button
              variant="secondary"
              onClick={close}
              disabled={createKey.isPending}
            >
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
