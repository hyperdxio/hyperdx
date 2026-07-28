import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Divider, Flex, Stack, Text } from '@mantine/core';
import { IconPencil, IconX } from '@tabler/icons-react';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_CLICKHOUSE_BUILD, IS_LOCAL_MODE } from '@/config';
import { useConnections } from '@/connection';

export default function ConnectionsSection() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { data: connections } = useConnections();
  const [editedConnectionId, setEditedConnectionId] = useState<string | null>(
    null,
  );
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);

  return (
    <Box id="connections" data-testid="connections-section">
      <Text size="md">{t('sections.connections')}</Text>
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
                    <b>{t('connections.host')}</b> {connection.host}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>{t('connections.username')}</b> {connection.username}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>{t('connections.password')}</b>{' '}
                    {t('connections.passwordConfigured')}
                  </Text>
                </Stack>
                {editedConnectionId !== connection.id ? (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(connection.id)}
                    size="sm"
                  >
                    <IconPencil size={14} className="me-2" />{' '}
                    {tCommon('actions.edit')}
                  </Button>
                ) : (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(null)}
                    size="sm"
                  >
                    <IconX size={14} className="me-2" />{' '}
                    {tCommon('actions.cancel')}
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
              {t('connections.add')}
            </Button>
          )}
        {isCreatingConnection && (
          <Stack gap="md">
            <ConnectionForm
              connection={{
                id: 'new',
                name: t('connections.defaultName'),
                host: IS_CLICKHOUSE_BUILD
                  ? window.location.origin
                  : 'http://localhost:8123',
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
