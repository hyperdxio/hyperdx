import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Box, Button, Flex, Group, Stack, Text } from '@mantine/core';

import api from '@/api';
import { testLocalConnection } from '@/clickhouse';
import { InputControlled } from '@/components/InputControlled';
import { IS_LOCAL_MODE } from '@/config';
import {
  Connection,
  useCreateConnection,
  useDeleteConnection,
  useUpdateConnection,
} from '@/connection';

import ConfirmDeleteMenu from './ConfirmDeleteMenu';

function useTestConnection({
  getValues,
}: {
  getValues: (name: string) => string;
}) {
  const testConnection = api.useTestConnection();
  const [testConnectionState, setTestConnectionState] = useState<
    null | 'loading' | 'valid' | 'invalid'
  >(null);

  const handleTestConnection = useCallback(async () => {
    const host = getValues('host');
    const username = getValues('username');
    const password = getValues('password');

    if (testConnectionState) {
      return;
    }

    setTestConnectionState('loading');

    if (IS_LOCAL_MODE) {
      try {
        const result = await testLocalConnection({ host, username, password });
        setTestConnectionState(result ? 'valid' : 'invalid');
      } catch (e) {
        console.error(e);
        setTestConnectionState('invalid');
      }
    } else {
      try {
        const result = await testConnection.mutateAsync({
          host,
          username,
          password,
        });
        setTestConnectionState(result.success ? 'valid' : 'invalid');
      } catch (e) {
        console.error(e);
        setTestConnectionState('invalid');
      }
    }

    setTimeout(() => {
      setTestConnectionState(null);
    }, 2000);
  }, [getValues, testConnection, testConnectionState]);

  return {
    testConnectionState,
    handleTestConnection,
  };
}

export function ConnectionForm({
  connection,
  isNew,
  onSave,
  onClose,
  showCancelButton = false,
  showDeleteButton = false,
}: {
  connection: Connection;
  isNew: boolean;
  onSave?: () => void;
  onClose?: () => void;
  showCancelButton?: boolean;
  showDeleteButton?: boolean;
}) {
  const { control, handleSubmit, resetField, getValues, formState } =
    useForm<Connection>({
      defaultValues: {
        id: connection.id,
        name: connection.name,
        host: connection.host,
        username: connection.username,
        password: connection.password,
      },
    });

  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();

  const onSubmit = (data: Connection) => {
    if (isNew) {
      createConnection.mutate(
        { connection: data },
        {
          onSuccess: () => {
            onSave?.();
          },
        },
      );
    } else {
      updateConnection.mutate(
        { connection: data, id: connection.id },
        {
          onSuccess: () => {
            onSave?.();
          },
        },
      );
    }
  };

  const [showUpdatePassword, setShowUpdatePassword] = useState(false);

  const { testConnectionState, handleTestConnection } = useTestConnection({
    getValues,
  });

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        handleSubmit(d => {
          onSubmit(d);
        })();
      }}
    >
      <Stack gap="md">
        <Box>
          <Text c="gray.4" size="xs" mb="xs">
            Connection Name
          </Text>
          <InputControlled
            name="name"
            control={control}
            placeholder="My Clickhouse Server"
            rules={{ required: 'Connection name is required' }}
          />
        </Box>
        <Box>
          <Text c="gray.4" size="xs" mb="xs">
            Host
          </Text>
          <InputControlled
            name="host"
            control={control}
            placeholder="http://localhost:8123"
            rules={{ required: 'Host is required' }}
          />
        </Box>
        <Box>
          <Text c="gray.4" size="xs" mb="xs">
            Username
          </Text>
          <InputControlled
            name="username"
            control={control}
            placeholder="Username (default: default)"
          />
        </Box>
        <Box>
          <Text c="gray.4" size="xs" mb="xs">
            Password
          </Text>
          {!showUpdatePassword && !isNew && (
            <Button
              variant="outline"
              color="gray.4"
              onClick={() => {
                setShowUpdatePassword(true);
              }}
            >
              Update Password
            </Button>
          )}
          {(showUpdatePassword || isNew) && (
            <Flex align="center" gap="sm">
              <InputControlled
                style={{ flexGrow: 1 }}
                name="password"
                control={control}
                placeholder="Password (default: blank)"
              />
              {!isNew && (
                <Button
                  variant="outline"
                  color="gray.4"
                  onClick={() => {
                    setShowUpdatePassword(false);
                    resetField('password');
                  }}
                >
                  Cancel
                </Button>
              )}
            </Flex>
          )}
        </Box>
        {createConnection.isError && (
          <Text c="red.7" size="sm">
            Error creating connection, please check the host and credentials and
            try again.
          </Text>
        )}
        <Group justify="space-between">
          <Group gap="xs" justify="flex-start">
            <Button
              variant="outline"
              type="submit"
              loading={
                isNew ? createConnection.isPending : updateConnection.isPending
              }
            >
              {isNew ? 'Create' : 'Save'}
            </Button>
            <Button
              disabled={!formState.isValid}
              variant="subtle"
              type="button"
              onClick={handleTestConnection}
              loading={testConnectionState === 'loading'}
              color={testConnectionState === 'invalid' ? 'yellow' : 'teal'}
            >
              {testConnectionState === 'valid' ? (
                <>Connection successful</>
              ) : testConnectionState === 'invalid' ? (
                <>Unable to connect</>
              ) : (
                'Test Connection'
              )}
            </Button>
          </Group>
          {!isNew && showDeleteButton !== false && (
            <ConfirmDeleteMenu
              onDelete={() =>
                deleteConnection.mutate(
                  { id: connection.id },
                  {
                    onSuccess: () => {
                      onClose?.();
                    },
                  },
                )
              }
            />
          )}
          {onClose && showCancelButton && (
            <Button variant="outline" color="gray.4" onClick={onClose}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  );
}
