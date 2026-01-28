import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Connection } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Button,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHelpCircle, IconSettings } from '@tabler/icons-react';

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
        hyperdxSettingPrefix: connection.hyperdxSettingPrefix,
      },
    });

  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();

  const onSubmit = (data: Connection) => {
    // Make sure we don't save a trailing slash in the host
    // Convert empty hyperdxSettingPrefix to null to signal clearing the field
    // (undefined gets stripped from JSON, null is preserved and handled by API)
    const normalizedData = {
      ...data,
      host: stripTrailingSlash(data.host),
      hyperdxSettingPrefix: data.hyperdxSettingPrefix || null,
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
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const { testConnectionState, handleTestConnection } = useTestConnection({
    getValues,
  });

  return (
    <form
      data-testid="connection-form"
      onSubmit={e => {
        e.preventDefault();
        handleSubmit(d => {
          onSubmit(d);
        })();
      }}
    >
      <Stack gap="md">
        <Box>
          <Text size="xs" mb="xs">
            Connection Name
          </Text>
          <InputControlled
            data-testid="connection-name-input"
            name="name"
            control={control}
            placeholder="My Clickhouse Server"
            rules={{ required: 'Connection name is required' }}
          />
        </Box>
        <Box>
          <Text size="xs" mb="xs">
            Host
          </Text>
          <InputControlled
            data-testid="connection-host-input"
            name="host"
            control={control}
            placeholder="http://localhost:8123"
            rules={{ required: 'Host is required' }}
          />
        </Box>
        <Box>
          <Text size="xs" mb="xs">
            Username
          </Text>
          <InputControlled
            data-testid="connection-username-input"
            name="username"
            control={control}
            placeholder="Username (default: default)"
          />
        </Box>
        <Box>
          <Text size="xs" mb="xs">
            Password
          </Text>
          {!showUpdatePassword && !isNew && (
            <Button
              data-testid="update-password-button"
              variant="secondary"
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
                data-testid="connection-password-input"
                style={{ flexGrow: 1 }}
                name="password"
                control={control}
                placeholder="Password (default: blank)"
              />
              {!isNew && (
                <Button
                  data-testid="cancel-password-button"
                  variant="secondary"
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
        <Box>
          {!showAdvancedSettings && (
            <Anchor
              underline="always"
              onClick={() => setShowAdvancedSettings(true)}
              size="xs"
            >
              <Group gap="xs">
                <IconSettings size={14} />
                Advanced Settings
              </Group>
            </Anchor>
          )}
          {showAdvancedSettings && (
            <Button
              onClick={() => setShowAdvancedSettings(false)}
              size="xs"
              variant="subtle"
            >
              Hide Advanced Settings
            </Button>
          )}
        </Box>
        <Box
          style={{
            display: showAdvancedSettings ? 'block' : 'none',
          }}
        >
          <Group gap="xs" mb="xs">
            <Text size="xs">Query Log Setting Prefix</Text>
            <Tooltip
              label="Tracks query origins by adding the current user's email to ClickHouse queries (as {prefix}_user in system.query_log). Requires 'custom_settings_prefixes' in your ClickHouse config.xml to include this exact value, otherwise queries will be rejected."
              color="dark"
              c="white"
              multiline
              maw={400}
            >
              <IconHelpCircle size={16} className="cursor-pointer" />
            </Tooltip>
          </Group>
          <InputControlled
            data-testid="connection-setting-prefix-input"
            name="hyperdxSettingPrefix"
            control={control}
            placeholder="hyperdx"
          />
        </Box>
        <Group justify="space-between">
          <Tooltip
            label="🔒 Password re-entry required for security"
            position="right"
            disabled={isNew}
            withArrow
          >
            <Button
              disabled={!formState.isValid}
              variant={
                testConnectionState === TestConnectionState.Invalid
                  ? 'danger'
                  : 'secondary'
              }
              type="button"
              onClick={handleTestConnection}
              loading={testConnectionState === TestConnectionState.Loading}
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
          <Group gap="xs">
            {onClose && showCancelButton && (
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )}
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
            <Button
              data-testid="connection-save-button"
              variant="primary"
              type="submit"
              loading={
                isNew ? createConnection.isPending : updateConnection.isPending
              }
            >
              {isNew ? 'Create' : 'Save'} Connection
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
