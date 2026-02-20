import { useCallback, useState } from 'react';
import Head from 'next/head';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { SubmitHandler, useForm } from 'react-hook-form';
import { DEFAULT_METADATA_MAX_ROWS_TO_READ } from '@hyperdx/common-utils/dist/core/metadata';
import { type TeamClickHouseSettings } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Card,
  Center,
  Container,
  Divider,
  Flex,
  Group,
  InputLabel,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconClipboard,
  IconHelpCircle,
  IconPencil,
  IconX,
} from '@tabler/icons-react';

import { ConnectionForm } from '@/components/ConnectionForm';
import SelectControlled from '@/components/SelectControlled';
import { SourcesList } from '@/components/Sources/SourcesList';
import { IS_LOCAL_MODE } from '@/config';

import { PageHeader } from './components/PageHeader';
import TeamMembersSection from './components/TeamSettings/TeamMembersSection';
import WebhooksSection from './components/TeamSettings/WebhooksSection';
import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { useConnections } from './connection';
import { DEFAULT_QUERY_TIMEOUT, DEFAULT_SEARCH_ROW_LIMIT } from './defaults';
import { withAppNav } from './layout';

function ConnectionsSection() {
  const { data: connections } = useConnections();

  const [editedConnectionId, setEditedConnectionId] = useState<string | null>(
    null,
  );
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);

  return (
    <Box id="connections">
      <Text size="md">Connections</Text>
      <Divider my="md" />
      <Card>
        <Stack mb="md">
          {connections?.map(c => (
            <Box key={c.id}>
              <Flex justify="space-between" align="flex-start">
                <Stack gap="xs">
                  <Text fw={500} size="lg">
                    {c.name}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Host:</b> {c.host}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Username:</b> {c.username}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Password:</b> [Configured]
                  </Text>
                </Stack>
                {editedConnectionId !== c.id && (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(c.id)}
                    size="sm"
                  >
                    <IconPencil size={14} className="me-2" /> Edit
                  </Button>
                )}
                {editedConnectionId === c.id && (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(null)}
                    size="sm"
                  >
                    <IconX size={14} className="me-2" /> Cancel
                  </Button>
                )}
              </Flex>
              {editedConnectionId === c.id && (
                <ConnectionForm
                  connection={c}
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

function SourcesSection() {
  return (
    <Box id="sources">
      <Text size="md">Sources</Text>
      <Divider my="md" />
      <SourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
function IntegrationsSection() {
  return (
    <Box id="integrations">
      <Text size="md">Integrations</Text>
      <Divider my="md" />
      <Card>
        <Stack gap="md">
          <WebhooksSection />
        </Stack>
      </Card>
    </Box>
  );
}

function TeamNameSection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const setTeamName = api.useSetTeamName();
  const hasAdminAccess = true;
  const [isEditingTeamName, setIsEditingTeamName] = useState(false);
  const form = useForm<{ name: string }>({
    defaultValues: {
      name: team?.name,
    },
  });

  const onSubmit: SubmitHandler<{ name: string }> = useCallback(
    async values => {
      setTeamName.mutate(
        { name: values.name },
        {
          onError: e => {
            notifications.show({
              color: 'red',
              message: 'Failed to update team name',
            });
          },
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Updated team name',
            });
            refetchTeam();
            setIsEditingTeamName(false);
          },
        },
      );
    },
    [refetchTeam, setTeamName],
  );
  return (
    <Box id="team_name">
      <Text size="md">Team Name</Text>
      <Divider my="md" />
      <Card>
        {isEditingTeamName ? (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Group gap="xs">
              <TextInput
                size="xs"
                placeholder="My Team"
                required
                error={form.formState.errors.name?.message}
                {...form.register('name', { required: true })}
                miw={300}
                min={1}
                max={100}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsEditingTeamName(false);
                  }
                }}
              />
              <Button
                type="submit"
                size="xs"
                variant="primary"
                loading={setTeamName.isPending}
              >
                Save
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={setTeamName.isPending}
                onClick={() => setIsEditingTeamName(false)}
              >
                Cancel
              </Button>
            </Group>
          </form>
        ) : (
          <Group gap="lg">
            <div className="fs-7">{team?.name}</div>
            {hasAdminAccess && (
              <Button
                size="xs"
                variant="secondary"
                leftSection={<IconPencil size={16} />}
                onClick={() => {
                  setIsEditingTeamName(true);
                }}
              >
                Change
              </Button>
            )}
          </Group>
        )}
      </Card>
    </Box>
  );
}

type ClickhouseSettingType = 'number' | 'boolean';

interface ClickhouseSettingFormProps {
  settingKey: keyof TeamClickHouseSettings;
  label: string;
  tooltip?: string;
  type: ClickhouseSettingType;
  defaultValue?: number | string;
  placeholder?: string;
  min?: number;
  max?: number;
  displayValue?: (value: any, defaultValue?: any) => string;
}

function ClickhouseSettingForm({
  settingKey,
  label,
  tooltip,
  type,
  defaultValue,
  placeholder,
  min,
  max,
  displayValue,
}: ClickhouseSettingFormProps) {
  const { data: me, refetch: refetchMe } = api.useMe();
  const updateClickhouseSettings = api.useUpdateClickhouseSettings();
  const hasAdminAccess = true;
  const [isEditing, setIsEditing] = useState(false);
  const currentValue = me?.team[settingKey];

  const form = useForm<{ value: any }>({
    defaultValues: {
      value:
        type === 'boolean' && displayValue != null && currentValue != null
          ? displayValue(currentValue)
          : (currentValue ?? defaultValue ?? ''),
    },
  });

  const onSubmit: SubmitHandler<{ value: any }> = useCallback(
    async values => {
      try {
        const settingValue =
          type === 'boolean'
            ? values.value === displayValue?.(true)
            : Number(values.value);

        updateClickhouseSettings.mutate(
          { [settingKey]: settingValue },
          {
            onError: e => {
              notifications.show({
                color: 'red',
                message: `Failed to update ${label}`,
              });
            },
            onSuccess: () => {
              notifications.show({
                color: 'green',
                message: `Updated ${label}`,
              });
              refetchMe();
              setIsEditing(false);
            },
          },
        );
      } catch (e) {
        notifications.show({
          color: 'red',
          message: e.message,
        });
      }
    },
    [
      refetchMe,
      updateClickhouseSettings,
      settingKey,
      label,
      type,
      displayValue,
    ],
  );

  return (
    <Stack gap="xs" mb="md">
      <Group gap="xs">
        <InputLabel size="md">{label}</InputLabel>
        {tooltip && (
          <Tooltip label={tooltip}>
            <Text size="sm" style={{ cursor: 'help' }}>
              <IconHelpCircle size={14} />
            </Text>
          </Tooltip>
        )}
      </Group>
      {isEditing && hasAdminAccess ? (
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Group>
            {type === 'boolean' && displayValue ? (
              <SelectControlled
                control={form.control}
                name="value"
                data={[displayValue(true), displayValue(false)]}
                size="xs"
                placeholder="Please select"
                withAsterisk
                miw={300}
                readOnly={!isEditing}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                  }
                }}
              />
            ) : (
              <TextInput
                size="xs"
                type="number"
                placeholder={
                  placeholder || currentValue?.toString() || `Enter value`
                }
                required
                readOnly={!isEditing}
                error={
                  form.formState.errors.value?.message as string | undefined
                }
                {...form.register('value', {
                  required: true,
                })}
                miw={300}
                min={min}
                max={max}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                  }
                }}
              />
            )}
            <Button
              type="submit"
              size="xs"
              variant="primary"
              loading={updateClickhouseSettings.isPending}
            >
              Save
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={updateClickhouseSettings.isPending}
              onClick={() => {
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
          </Group>
        </form>
      ) : (
        <Group>
          <Text className="text-white">
            {displayValue
              ? displayValue(currentValue, defaultValue)
              : currentValue?.toString() || 'Not set'}
          </Text>
          {hasAdminAccess && (
            <Button
              size="xs"
              variant="secondary"
              leftSection={<IconPencil size={16} />}
              onClick={() => setIsEditing(true)}
            >
              Change
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

function TeamQueryConfigSection() {
  const brandName = useBrandDisplayName();
  const displayValueWithUnit =
    (unit: string) => (value: any, defaultValue?: any) =>
      value === undefined || value === defaultValue
        ? `${defaultValue.toLocaleString()} ${unit} (System Default)`
        : value === 0
          ? 'Unlimited'
          : `${value.toLocaleString()} ${unit}`;

  return (
    <Box id="team_name">
      <Text size="md">ClickHouse Client Settings</Text>
      <Divider my="md" />
      <Card>
        <Stack>
          <ClickhouseSettingForm
            settingKey="searchRowLimit"
            label="Search Row Limit"
            tooltip="The number of rows per query for the Search page or search dashboard tiles"
            type="number"
            defaultValue={DEFAULT_SEARCH_ROW_LIMIT}
            placeholder={`default = ${DEFAULT_SEARCH_ROW_LIMIT}, 0 = unlimited`}
            min={1}
            max={100000}
            displayValue={displayValueWithUnit('rows')}
          />
          <ClickhouseSettingForm
            settingKey="queryTimeout"
            label="Query Timeout (seconds)"
            tooltip="Sets the max execution time of a query in seconds."
            type="number"
            defaultValue={DEFAULT_QUERY_TIMEOUT}
            placeholder={`default = ${DEFAULT_QUERY_TIMEOUT}, 0 = unlimited`}
            min={0}
            displayValue={displayValueWithUnit('seconds')}
          />
          <ClickhouseSettingForm
            settingKey="metadataMaxRowsToRead"
            label="Max Rows to Read (METADATA ONLY)"
            tooltip="The maximum number of rows that can be read from a table when running a query"
            type="number"
            defaultValue={DEFAULT_METADATA_MAX_ROWS_TO_READ}
            placeholder={`default = ${DEFAULT_METADATA_MAX_ROWS_TO_READ.toLocaleString()}, 0 = unlimited`}
            min={0}
            displayValue={displayValueWithUnit('rows')}
          />
          <ClickhouseSettingForm
            settingKey="fieldMetadataDisabled"
            label="Field Metadata Queries"
            tooltip="Enable to fetch field metadata from ClickHouse"
            type="boolean"
            displayValue={value => (value ? 'Disabled' : 'Enabled')}
          />
          <ClickhouseSettingForm
            settingKey="parallelizeWhenPossible"
            label="Parallelize Queries When Possible"
            tooltip={`${brandName} sends windowed queries to ClickHouse in series. This setting parallelizes those queries when it makes sense to. This may cause increased peak load on ClickHouse`}
            type="boolean"
            displayValue={value => (value ? 'Enabled' : 'Disabled')}
          />
        </Stack>
      </Card>
    </Box>
  );
}

const APIKeyCopyButton = ({
  value,
  dataTestId,
}: {
  value: string;
  dataTestId?: string;
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <CopyToClipboard text={value}>
      <Button
        onClick={() => setCopied(true)}
        variant={copied ? 'light' : 'default'}
        color="gray"
        rightSection={
          <Group wrap="nowrap" gap={4} ms="xs">
            {copied ? <IconCheck size={14} /> : <IconClipboard size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </Group>
        }
      >
        <div data-test-id={dataTestId} className="text-wrap text-break">
          {value}
        </div>
      </Button>
    </CopyToClipboard>
  );
};

function ApiKeysSection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const hasAdminAccess = true;
  const [
    rotateApiKeyConfirmationModalShow,
    setRotateApiKeyConfirmationModalShow,
  ] = useState(false);
  const rotateTeamApiKeyAction = () => {
    rotateTeamApiKey.mutate(undefined, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message: 'Revoked old API key and generated new key.',
        });
        refetchTeam();
      },
      onError: e => {
        notifications.show({
          color: 'red',
          message: e.message,
          autoClose: 5000,
        });
      },
    });
  };
  const onConfirmUpdateTeamApiKey = () => {
    rotateTeamApiKeyAction();
    setRotateApiKeyConfirmationModalShow(false);
  };

  return (
    <Box id="api_keys">
      <Text size="md">API Keys</Text>
      <Divider my="md" />
      <Card mb="md">
        <Text mb="md">Ingestion API Key</Text>
        <Group gap="xs">
          {team?.apiKey && (
            <APIKeyCopyButton value={team.apiKey} dataTestId="api-key" />
          )}
          {hasAdminAccess && (
            <Button
              variant="danger"
              onClick={() => setRotateApiKeyConfirmationModalShow(true)}
            >
              Rotate API Key
            </Button>
          )}
        </Group>
        <Modal
          aria-labelledby="contained-modal-title-vcenter"
          centered
          onClose={() => setRotateApiKeyConfirmationModalShow(false)}
          opened={rotateApiKeyConfirmationModalShow}
          size="lg"
          title={
            <Text size="xl">
              <b>Rotate API Key</b>
            </Text>
          }
        >
          <Modal.Body>
            <Text size="md">
              Rotating the API key will invalidate your existing API key and
              generate a new one for you. This action is <b>not reversible</b>.
            </Text>
            <Group justify="end">
              <Button
                variant="secondary"
                className="mt-2 px-4 ms-2 float-end"
                size="sm"
                onClick={() => setRotateApiKeyConfirmationModalShow(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                className="mt-2 px-4 float-end"
                size="sm"
                onClick={onConfirmUpdateTeamApiKey}
              >
                Confirm
              </Button>
            </Group>
          </Modal.Body>
        </Modal>
      </Card>
      {!isLoadingMe && me != null && (
        <Card>
          <Card.Section p="md">
            <Text mb="md">Personal API Access Key</Text>
            <APIKeyCopyButton value={me.accessKey} dataTestId="api-key" />
          </Card.Section>
        </Card>
      )}
    </Box>
  );
}

export default function TeamPage() {
  const brandName = useBrandDisplayName();
  const { data: team, isLoading } = api.useTeam();
  const hasAllowedAuthMethods =
    team?.allowedAuthMethods != null && team?.allowedAuthMethods.length > 0;

  return (
    <div className="TeamPage">
      <Head>
        <title>My Team - {brandName}</title>
      </Head>
      <PageHeader>
        <div>{team?.name || 'My team'}</div>
      </PageHeader>
      <div>
        <Container>
          {isLoading && (
            <Center mt="xl">
              <Loader color="dimmed" />
            </Center>
          )}
          {!isLoading && team != null && (
            <Stack my={20} gap="xl">
              <SourcesSection />
              <ConnectionsSection />
              <IntegrationsSection />
              <TeamNameSection />
              <TeamQueryConfigSection />
              <ApiKeysSection />

              {hasAllowedAuthMethods && (
                <>
                  <h2>Security Policies</h2>
                  {team.allowedAuthMethods != null &&
                    team.allowedAuthMethods.length > 0 && (
                      <div className="mb-2 text-muted">
                        Team members can only authenticate via:{' '}
                        <span className="text-capitalize fw-bold">
                          {team.allowedAuthMethods.join(', ')}
                        </span>
                      </div>
                    )}
                </>
              )}
              <TeamMembersSection />
            </Stack>
          )}
        </Container>
      </div>
    </div>
  );
}

TeamPage.getLayout = withAppNav;
