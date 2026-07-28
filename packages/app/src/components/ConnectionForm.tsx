import { useCallback, useState } from 'react';
import { omit } from 'lodash';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Connection } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Button,
  Flex,
  Group,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHelpCircle, IconSettings } from '@tabler/icons-react';

import api from '@/api';
import {
  InputControlled,
  PasswordInputControlled,
  TextInputControlled,
} from '@/components/InputControlled';
import {
  IS_CLICKHOUSE_BUILD,
  IS_LOCAL_MODE,
  IS_PROMQL_ENABLED,
} from '@/config';
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
  const { t } = useTranslation('settings');
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
            message: t('connections.form.testFailed'),
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
            message: result.error || t('connections.form.testFailed'),
            autoClose: 5000,
          });
        }
      } catch (error: any) {
        const body = await error.response?.json();
        setTestConnectionState(TestConnectionState.Invalid);
        notifications.show({
          color: 'red',
          message: body?.error ?? t('connections.form.testRequestFailed'),
          autoClose: 5000,
        });
      }
    }

    setTimeout(() => {
      setTestConnectionState(null);
    }, 2000);
  }, [getValues, t, testConnection, testConnectionState]);

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
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { control, handleSubmit, resetField, getValues, formState, trigger } =
    useForm<Connection>({
      defaultValues: {
        id: connection.id,
        name: connection.name,
        host: connection.host ?? '',
        username: connection.username,
        password: connection.password,
        hyperdxSettingPrefix: connection.hyperdxSettingPrefix,
        isPrometheusEndpoint: connection.isPrometheusEndpoint,
      },
    });

  const watchedHost = useWatch({ control, name: 'host' });
  const isPrometheusEndpoint = useWatch({
    control,
    name: 'isPrometheusEndpoint',
  });

  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();

  const onSubmit = (data: Connection) => {
    const stripped = data.host ? stripTrailingSlash(data.host) : '';
    const normalizedData: Connection = data.isPrometheusEndpoint
      ? {
          ...data,
          host: stripped,
          username: '',
          hyperdxSettingPrefix: null,
        }
      : {
          ...data,
          host: stripped,
          hyperdxSettingPrefix: data.hyperdxSettingPrefix || null,
        };

    if (isNew) {
      const connection = omit(normalizedData, ['id']);
      createConnection.mutate(
        { connection },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: t('connections.form.created'),
            });
            onSave?.();
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message: t('connections.form.createFailed'),
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
              message: t('connections.form.updated'),
            });
            onSave?.();
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message: t('connections.form.updateFailed'),
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
            {t('connections.form.name')}
          </Text>
          <InputControlled
            data-testid="connection-name-input"
            name="name"
            control={control}
            placeholder={t('connections.form.namePlaceholder')}
            rules={{ required: t('connections.form.nameRequired') }}
          />
        </Box>
        <Box>
          <Group gap="xs" mb="xs">
            <Text size="xs">{t('connections.form.host')}</Text>
            <Tooltip
              label={
                isPrometheusEndpoint
                  ? t('connections.form.hostHelpPrometheus')
                  : t('connections.form.hostHelp')
              }
              color="dark"
              c="white"
              multiline
              maw={400}
            >
              <IconHelpCircle size={16} className="cursor-pointer" />
            </Tooltip>
          </Group>
          <TextInputControlled
            data-testid="connection-host-input"
            name="host"
            control={control}
            placeholder={
              isPrometheusEndpoint
                ? 'http://thanos-querier:10902'
                : IS_CLICKHOUSE_BUILD
                  ? window.location.origin
                  : 'http://localhost:8123'
            }
            rules={{
              validate: value => {
                if (typeof value !== 'string' || !value) {
                  return t('connections.form.hostRequired');
                }
                if (isPrometheusEndpoint) {
                  try {
                    new URL(value);
                    return true;
                  } catch {
                    return t('connections.form.hostInvalid');
                  }
                }
                return true;
              },
            }}
          />
        </Box>
        {!isPrometheusEndpoint && (
          <>
            <Box>
              <Text size="xs" mb="xs">
                {t('connections.form.username')}
              </Text>
              <InputControlled
                data-testid="connection-username-input"
                name="username"
                control={control}
                placeholder={t('connections.form.usernamePlaceholder')}
              />
            </Box>
            <Box>
              <Text size="xs" mb="xs">
                {t('connections.form.password')}
              </Text>
              {!showUpdatePassword && !isNew && (
                <Button
                  data-testid="update-password-button"
                  variant="secondary"
                  onClick={() => {
                    setShowUpdatePassword(true);
                  }}
                >
                  {t('connections.form.updatePassword')}
                </Button>
              )}
              {(showUpdatePassword || isNew) && (
                <Flex align="center" gap="sm">
                  <PasswordInputControlled
                    data-testid="connection-password-input"
                    style={{ flexGrow: 1 }}
                    name="password"
                    control={control}
                    placeholder={t('connections.form.passwordPlaceholder')}
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
                      {tCommon('actions.cancel')}
                    </Button>
                  )}
                </Flex>
              )}
            </Box>
          </>
        )}
        <Box>
          {!showAdvancedSettings && (
            <Anchor
              underline="always"
              onClick={() => setShowAdvancedSettings(true)}
              size="xs"
            >
              <Group gap="xs">
                <IconSettings size={14} />
                {t('connections.form.advancedSettings')}
              </Group>
            </Anchor>
          )}
          {showAdvancedSettings && (
            <Button
              onClick={() => setShowAdvancedSettings(false)}
              size="xs"
              variant="subtle"
            >
              {t('connections.form.hideAdvancedSettings')}
            </Button>
          )}
        </Box>
        <Box
          style={{
            display: showAdvancedSettings ? 'block' : 'none',
          }}
        >
          <Stack gap="md">
            {IS_PROMQL_ENABLED && (
              <Box>
                <Controller
                  control={control}
                  name="isPrometheusEndpoint"
                  render={({ field: { value, onChange } }) => (
                    <Group gap="xs">
                      <Switch
                        data-testid="connection-prometheus-compatible-switch"
                        checked={!!value}
                        onChange={e => {
                          onChange(e.currentTarget.checked);
                          if (
                            formState.isSubmitted ||
                            formState.touchedFields.host
                          ) {
                            void trigger('host');
                          }
                        }}
                      />
                      <Text size="sm">
                        {t('connections.form.prometheusCompatible')}
                      </Text>
                      <Tooltip
                        label={t('connections.form.prometheusCompatibleHelp')}
                        color="dark"
                        c="white"
                        multiline
                        maw={400}
                      >
                        <IconHelpCircle size={16} className="cursor-pointer" />
                      </Tooltip>
                    </Group>
                  )}
                />
              </Box>
            )}
            {!isPrometheusEndpoint && (
              <Box>
                <Group gap="xs" mb="xs">
                  <Text size="xs">{t('connections.form.settingPrefix')}</Text>
                  <Tooltip
                    label={t('connections.form.settingPrefixHelp')}
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
            )}
          </Stack>
        </Box>
        <Group justify="space-between">
          <Tooltip
            label={
              isPrometheusEndpoint
                ? t('connections.form.testDisabledPrometheus')
                : !watchedHost
                  ? t('connections.form.testDisabledNoHost')
                  : t('connections.form.testDisabledPassword')
            }
            position="right"
            disabled={isNew && !!watchedHost && !isPrometheusEndpoint}
            withArrow
          >
            <Button
              disabled={
                !formState.isValid || !watchedHost || isPrometheusEndpoint
              }
              variant={
                testConnectionState === TestConnectionState.Invalid
                  ? 'danger'
                  : 'secondary'
              }
              type="button"
              onClick={handleTestConnection}
              loading={testConnectionState === TestConnectionState.Loading}
            >
              {testConnectionState === TestConnectionState.Valid
                ? t('connections.form.testSuccessful')
                : testConnectionState === TestConnectionState.Invalid
                  ? t('connections.form.testUnableToConnect')
                  : t('connections.form.test')}
            </Button>
          </Tooltip>
          <Group gap="xs">
            {onClose && showCancelButton && (
              <Button variant="secondary" onClick={onClose}>
                {tCommon('actions.cancel')}
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
              {isNew
                ? t('connections.form.create')
                : t('connections.form.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
