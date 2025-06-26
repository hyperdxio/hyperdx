import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse';
import { Connection } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex, Group, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import {
  InputControlled,
  PasswordInputControlled,
} from '@/components/InputControlled';
import { IS_LOCAL_MODE } from '@/config';
import {
  useCreateConnection,
  useDeleteConnection,
  useUpdateConnection,
} from '@/connection';
import { stripTrailingSlash } from '@/utils';

import ConfirmDeleteMenu from './ConfirmDeleteMenu';

enum TestConnectionState {
  Loading = 'loading',
  Valid = 'valid',
  Invalid = 'invalid',
}

function useTestConnection({
  getValues,
}: {
  getValues: (name: string) => string;
}) {
  const testConnection = api.useTestConnection();
  const [testConnectionState, setTestConnectionState] =
    useState<TestConnectionState | null>(null);

  const handleTestConnection = useCallback(async () => {
    const hostValue = getValues('host');
    const username = getValues('username');
    const password = getValues('password');
    const host = stripTrailingSlash(hostValue);

    if (testConnectionState) {
      return;
    }

    setTestConnectionState(TestConnectionState.Loading);

    if (IS_LOCAL_MODE) {
      try {
        const result = await testLocalConnection({ host, username, password });
        if (result) {
          setTestConnectionState(TestConnectionState.Valid);
        } else {
          setTestConnectionState(TestConnectionState.Invalid);
          notifications.show({
            color: 'red',
            message: 'Connection test failed',
            autoClose: 5000,
          });
        }
      } catch (e) {
        console.error(e);
        setTestConnectionState(TestConnectionState.Invalid);
        notifications.show({
          color: 'red',
          message: e.message,
          autoClose: 5000,
        });
      }
    } else {
      try {
        const result = await testConnection.mutateAsync({
          host,
          username,
          password,
        });
        if (result.success) {
          setTestConnectionState(TestConnectionState.Valid);
        } else {
          setTestConnectionState(TestConnectionState.Invalid);
          notifications.show({
            color: 'red',
            message: result.error || 'Connection test failed',
            autoClose: 5000,
          });
        }
      } catch (error: any) {
        const body = await error.response?.json();
        setTestConnectionState(TestConnectionState.Invalid);
        notifications.show({
          color: 'red',
          message: body?.error ?? 'Failed to test connection',
          autoClose: 5000,
        });
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
    // Make sure we don't save a trailing slash in the host
    const normalizedData = {
      ...data,
      host: stripTrailingSlash(data.host),
    };

    if (isNew) {
      const { id, ...connection } = normalizedData;
      createConnection.mutate(
        { connection },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Connection created successfully',
            });
            onSave?.();
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message:
                'Error creating connection, please check the host and credentials and try again.',
              autoClose: 5000,
            });
          },
        },
      );
    } else {
      updateConnection.mutate(
        { connection: normalizedData, id: connection.id },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Connection updated successfully',
            });
            onSave?.();
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message:
                'Error updating connection, please check the host and credentials and try again.',
              autoClose: 5000,
            });
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
              <PasswordInputControlled
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
            <Tooltip
              label="🔒 Password re-entry required for security"
              position="right"
              disabled={isNew}
              withArrow
            >
              <Button
                disabled={!formState.isValid}
                variant="subtle"
                type="button"
                onClick={handleTestConnection}
                loading={testConnectionState === TestConnectionState.Loading}
                color={
                  testConnectionState === TestConnectionState.Invalid
                    ? 'yellow'
                    : 'teal'
                }
              >
                {testConnectionState === TestConnectionState.Valid ? (
                  <>Connection successful</>
                ) : testConnectionState === TestConnectionState.Invalid ? (
                  <>Unable to connect</>
                ) : (
                  'Test Connection'
                )}
              </Button>
            </Tooltip>
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
