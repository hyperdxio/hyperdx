import { useState } from 'react';
import { Box, Button, Card, Divider, Flex, Stack, Text } from '@mantine/core';
import { IconPencil, IconX } from '@tabler/icons-react';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_LOCAL_MODE } from '@/config';
import { useConnections } from '@/connection';

export default function ConnectionsSection() {
  const { data: connections } = useConnections();
  const [editedConnectionId, setEditedConnectionId] = useState<string | null>(
    null,
  );
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);

  return (
    <Box id="connections" data-testid="connections-section">
      <Text size="md">Connections</Text>
      <Divider my="md" />
      <Card>
        <Stack mb="md">
          {connections?.map(connection => (
            <Box key={connection.id}>
              <Flex justify="space-between" align="flex-start">
                <Stack gap="xs">
                  <Text fw={500} size="lg">
                    {connection.name}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Host:</b> {connection.host}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Username:</b> {connection.username}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Password:</b> [Configured]
                  </Text>
                </Stack>
                {editedConnectionId !== connection.id ? (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(connection.id)}
                    size="sm"
                  >
                    <IconPencil size={14} className="me-2" /> Edit
                  </Button>
                ) : (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(null)}
                    size="sm"
                  >
                    <IconX size={14} className="me-2" /> Cancel
                  </Button>
                )}
              </Flex>
              {editedConnectionId === connection.id && (
                <ConnectionForm
                  connection={connection}
                  isNew={false}
                  onSave={() => {
                    setEditedConnectionId(null);
                  }}
                  showCancelButton={false}
                  showDeleteButton
                />
              )}
              <Divider my="md" />
            </Box>
          ))}
        </Stack>
        {!isCreatingConnection &&
          (IS_LOCAL_MODE ? (connections?.length ?? 0) < 1 : true) && (
            <Button
              data-testid="add-connection-button"
              variant="primary"
              onClick={() => setIsCreatingConnection(true)}
            >
              Add Connection
            </Button>
          )}
        {isCreatingConnection && (
          <Stack gap="md">
            <ConnectionForm
              connection={{
                id: 'new',
                name: 'My New Connection',
                host: 'http://localhost:8123',
                username: 'default',
                password: '',
              }}
              isNew={true}
              onSave={() => setIsCreatingConnection(false)}
              onClose={() => setIsCreatingConnection(false)}
              showCancelButton
            />
          </Stack>
        )}
      </Card>
    </Box>
  );
}
