import { useEffect, useState } from 'react';
import type { OrgApiKeyApiResponse } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Table,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import EmptyState from '@/components/EmptyState';
import { InlineNameInput } from '@/components/InlineNameInput/InlineNameInput';
import { useConfirm } from '@/useConfirm';

import CreateOrgApiKeyModal from './CreateOrgApiKeyModal';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

// Expiry is shown to the day, so a minute tick is enough to flip the badge.
const EXPIRY_TICK_MS = 60_000;

// Only read in a state initialiser and the interval, never during render.
// eslint-disable-next-line no-restricted-syntax
const currentTime = () => Date.now();

function useNow() {
  const [now, setNow] = useState(currentTime);
  useEffect(() => {
    const id = window.setInterval(() => setNow(currentTime()), EXPIRY_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function OrgApiKeyRow({
  apiKey,
  now,
}: {
  apiKey: OrgApiKeyApiResponse;
  now: number;
}) {
  const updateKey = api.useUpdateOrgApiKey();
  const deleteKey = api.useDeleteOrgApiKey();
  const confirm = useConfirm();
  const isExpired =
    apiKey.expiresAt != null && Date.parse(apiKey.expiresAt) <= now;

  const onRevoke = async () => {
    const confirmed = await confirm(
      "Revoking this key immediately breaks anything still using it. This can't be undone.",
      'Revoke',
      { variant: 'danger' },
    );
    if (!confirmed) {
      return;
    }
    deleteKey.mutate(
      { id: apiKey.id },
      {
        onError: e => notifications.show({ color: 'red', message: e.message }),
      },
    );
  };

  return (
    <Table.Tr>
      <Table.Td>
        <InlineNameInput
          size="xs"
          aria-label="API key description"
          placeholder="Untitled API key"
          value={apiKey.description}
          maxLength={100}
          onCommit={description =>
            updateKey.mutateAsync({ id: apiKey.id, description }).catch(e => {
              notifications.show({
                color: 'red',
                message: `Couldn't rename API key: ${e.message}`,
              });
              throw e;
            })
          }
        />
      </Table.Td>
      <Table.Td>{apiKey.scope === 'admin' ? 'Admin' : 'Member'}</Table.Td>
      <Table.Td>
        {apiKey.createdBy
          ? apiKey.createdBy.name || apiKey.createdBy.email
          : 'Deleted user'}
      </Table.Td>
      <Table.Td>{formatDate(apiKey.createdAt)}</Table.Td>
      <Table.Td>
        {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never'}
      </Table.Td>
      <Table.Td>
        {isExpired ? (
          <Badge color="red" variant="light">
            Expired
          </Badge>
        ) : apiKey.expiresAt ? (
          formatDate(apiKey.expiresAt)
        ) : (
          'Never'
        )}
      </Table.Td>
      <Table.Td>
        <Button variant="danger" size="xs" onClick={onRevoke}>
          Revoke
        </Button>
      </Table.Td>
    </Table.Tr>
  );
}

export default function OrgApiKeysSection() {
  const { data, isLoading, isError } = api.useOrgApiKeys();
  const now = useNow();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const keys = data?.data ?? [];

  return (
    <Box id="org_api_keys" data-testid="org-api-keys-section">
      <Group justify="space-between">
        <Box>
          <Text size="md">Organization API keys</Text>
          <Text size="sm" c="dimmed">
            Keys owned by the team. They keep working when the person who
            created them leaves.
          </Text>
        </Box>
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          Create API key
        </Button>
      </Group>
      <Divider my="md" />
      {isError ? (
        <Text size="sm" variant="danger">
          Couldn&apos;t load organization API keys
        </Text>
      ) : !isLoading && keys.length === 0 ? (
        <EmptyState variant="card" title="No organization API keys yet" />
      ) : (
        <Card>
          <Table horizontalSpacing="md" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Description</Table.Th>
                <Table.Th>Scope</Table.Th>
                <Table.Th>Created by</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Last used</Table.Th>
                <Table.Th>Expires</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.map(apiKey => (
                <OrgApiKeyRow key={apiKey.id} apiKey={apiKey} now={now} />
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
      <CreateOrgApiKeyModal
        opened={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </Box>
  );
}
