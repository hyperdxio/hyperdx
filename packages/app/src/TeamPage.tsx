import { Fragment, useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import { HTTPError } from 'ky';
import {
  Button as BSButton,
  Form,
  Modal as BSModal,
  Spinner,
} from 'react-bootstrap';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { SubmitHandler, useForm } from 'react-hook-form';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Flex,
  Group,
  Modal as MModal,
  Radio,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import CodeMirror, { placeholder } from '@uiw/react-codemirror';

import { ConnectionForm } from '@/components/ConnectionForm';
import { TableSourceForm } from '@/components/SourceForm';
import { IS_LOCAL_MODE } from '@/config';

import { PageHeader } from './components/PageHeader';
import api from './api';
import { useConnections } from './connection';
import { withAppNav } from './layout';
import { useSources } from './source';
import { useConfirm } from './useConfirm';
import { capitalizeFirstLetter } from './utils';

import styles from '../styles/TeamPage.module.scss';

const DEFAULT_GENERIC_WEBHOOK_BODY = ['{{title}}', '{{body}}', '{{link}}'];
const DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE =
  DEFAULT_GENERIC_WEBHOOK_BODY.join(' | ');

const jsonLinterWithEmptyCheck = () => (editorView: EditorView) => {
  const text = editorView.state.doc.toString().trim();
  if (text === '') return [];
  return jsonParseLinter()(editorView);
};

function InviteTeamMemberForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting?: boolean;
  onSubmit: (arg0: { email: string }) => void;
}) {
  const [email, setEmail] = useState<string>('');

  return (
    <form
      onSubmit={e => {
        onSubmit({ email });
        e.preventDefault();
      }}
    >
      <Stack>
        <TextInput
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder="you@company.com"
          withAsterisk={false}
        />
        <div className="text-slate-300 fs-8">
          The invite link will automatically expire after 30 days.
        </div>
        <Button variant="light" type="submit" disabled={!email || isSubmitting}>
          Send Invite
        </Button>
      </Stack>
    </form>
  );
}

function ConnectionsSection() {
  const { data: connections } = useConnections();

  const [editedConnectionId, setEditedConnectionId] = useState<string | null>(
    null,
  );
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);

  return (
    <Box>
      <Text size="md" c="gray.4">
        Connections
      </Text>
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
                    color="gray.4"
                    onClick={() => setEditedConnectionId(c.id)}
                    size="sm"
                  >
                    <i className="bi bi-pencil-fill me-2" /> Edit
                  </Button>
                )}
                {editedConnectionId === c.id && (
                  <Button
                    variant="subtle"
                    color="gray.4"
                    onClick={() => setEditedConnectionId(null)}
                    size="sm"
                  >
                    <i className="bi bi-x-lg me-2" /> Cancel
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
              variant="outline"
              color="gray.4"
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
  const { data: sources } = useSources();

  const [editedSourceId, setEditedSourceId] = useState<string | null>(null);
  const [isCreatingSource, setIsCreatingSource] = useState(false);

  return (
    <Box>
      <Text size="md" c="gray.4">
        Sources
      </Text>
      <Divider my="md" />
      <Card>
        <Stack>
          {sources?.map(s => (
            <>
              <Flex key={s.id} justify="space-between" align="center">
                <div>
                  <Text>{s.name}</Text>
                  <Text size="xxs" c="dimmed">
                    {capitalizeFirstLetter(s.kind)}
                    {s.from && (
                      <>
                        {' '}
                        &middot; <span className="bi-database me-1" />
                        {s.from.databaseName}.{s.from.tableName}
                      </>
                    )}
                  </Text>
                </div>
                {editedSourceId !== s.id && (
                  <Button
                    variant="subtle"
                    color="gray.4"
                    onClick={() => setEditedSourceId(s.id)}
                    size="sm"
                  >
                    <i className="bi bi-chevron-down" />
                  </Button>
                )}
                {editedSourceId === s.id && (
                  <Button
                    variant="subtle"
                    color="gray.4"
                    onClick={() => setEditedSourceId(null)}
                    size="sm"
                  >
                    <i className="bi bi-chevron-up" />
                  </Button>
                )}
              </Flex>
              {editedSourceId === s.id && (
                <TableSourceForm
                  sourceId={s.id}
                  onSave={() => setEditedSourceId(null)}
                />
              )}
              <Divider />
            </>
          ))}
          {!IS_LOCAL_MODE && isCreatingSource && (
            <TableSourceForm
              isNew
              onCreate={() => {
                setIsCreatingSource(false);
              }}
              onCancel={() => setIsCreatingSource(false)}
            />
          )}
          {!IS_LOCAL_MODE && !isCreatingSource && (
            <Button
              variant="outline"
              onClick={() => setIsCreatingSource(true)}
              color="gray.4"
            >
              Add Source
            </Button>
          )}
        </Stack>
      </Card>
    </Box>
  );
}

function TeamMembersSection() {
  const hasAdminAccess = true;

  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const { data: team } = api.useTeam();
  const {
    data: members,
    isLoading: isLoadingMembers,
    refetch: refetchMembers,
  } = api.useTeamMembers();

  const {
    data: invitations,
    isLoading: isLoadingInvitations,
    refetch: refetchInvitations,
  } = api.useTeamInvitations();

  const onSubmitTeamInviteForm = ({ email }: { email: string }) => {
    sendTeamInviteAction(email);
    setTeamInviteModalShow(false);
  };

  const [
    deleteTeamMemberConfirmationModalData,
    setDeleteTeamMemberConfirmationModalData,
  ] = useState<{
    mode: 'team' | 'teamInvite' | null;
    id: string | null;
    email: string | null;
  }>({
    mode: null,
    id: null,
    email: null,
  });
  const [teamInviteModalShow, setTeamInviteModalShow] = useState(false);

  const saveTeamInvitation = api.useSaveTeamInvitation();
  const deleteTeamMember = api.useDeleteTeamMember();
  const deleteTeamInvitation = api.useDeleteTeamInvitation();

  const sendTeamInviteAction = (email: string) => {
    if (email) {
      saveTeamInvitation.mutate(
        { email },
        {
          onSuccess: resp => {
            notifications.show({
              color: 'green',
              message:
                'Click "Copy URL" and share the URL with your team member',
            });
            refetchInvitations();
          },
          onError: e => {
            if (e instanceof HTTPError) {
              e.response
                .json()
                .then(res => {
                  notifications.show({
                    color: 'red',
                    message: res.message,
                    autoClose: 5000,
                  });
                })
                .catch(() => {
                  notifications.show({
                    color: 'red',
                    message:
                      'Something went wrong. Please contact HyperDX team.',

                    autoClose: 5000,
                  });
                });
            } else {
              notifications.show({
                color: 'red',
                message: 'Something went wrong. Please contact HyperDX team.',
                autoClose: 5000,
              });
            }
          },
        },
      );
    }
  };

  const onConfirmDeleteTeamMember = (id: string) => {
    if (deleteTeamMemberConfirmationModalData.mode === 'team') {
      deleteTeamMemberAction(id);
    } else if (deleteTeamMemberConfirmationModalData.mode === 'teamInvite') {
      deleteTeamInviteAction(id);
    }
    setDeleteTeamMemberConfirmationModalData({
      mode: null,
      id: null,
      email: null,
    });
  };

  const deleteTeamInviteAction = (id: string) => {
    if (id) {
      deleteTeamInvitation.mutate(
        { id: encodeURIComponent(id) },
        {
          onSuccess: resp => {
            notifications.show({
              color: 'green',
              message: 'Deleted team invite',
            });
            refetchInvitations();
          },
          onError: e => {
            if (e instanceof HTTPError) {
              e.response
                .json()
                .then(res => {
                  notifications.show({
                    color: 'red',
                    message: res.message,
                    autoClose: 5000,
                  });
                })
                .catch(() => {
                  notifications.show({
                    color: 'red',
                    message:
                      'Something went wrong. Please contact HyperDX team.',

                    autoClose: 5000,
                  });
                });
            } else {
              notifications.show({
                color: 'red',
                message: 'Something went wrong. Please contact HyperDX team.',
                autoClose: 5000,
              });
            }
          },
        },
      );
    }
  };
  const deleteTeamMemberAction = (id: string) => {
    if (id) {
      deleteTeamMember.mutate(
        { userId: encodeURIComponent(id) },
        {
          onSuccess: resp => {
            notifications.show({
              color: 'green',
              message: 'Deleted team member',
            });
            refetchMembers();
          },
          onError: e => {
            if (e instanceof HTTPError) {
              e.response
                .json()
                .then(res => {
                  notifications.show({
                    color: 'red',
                    message: res.message,
                    autoClose: 5000,
                  });
                })
                .catch(() => {
                  notifications.show({
                    color: 'red',
                    message:
                      'Something went wrong. Please contact HyperDX team.',
                    autoClose: 5000,
                  });
                });
            } else {
              notifications.show({
                color: 'red',
                message: 'Something went wrong. Please contact HyperDX team.',
                autoClose: 5000,
              });
            }
          },
        },
      );
    }
  };

  return (
    <Box>
      <Text size="md" c="gray.4">
        Team
      </Text>
      <Divider my="md" />

      <Card>
        <Card.Section withBorder py="sm" px="lg">
          <Group align="center" justify="space-between">
            <div className="text-slate-300 fs-7">Team Members</div>
            <Button
              variant="light"
              leftSection={<i className="bi bi-person-plus-fill" />}
              onClick={() => setTeamInviteModalShow(true)}
            >
              Invite Team Member
            </Button>
          </Group>
        </Card.Section>
        <Card.Section>
          <Table horizontalSpacing="lg" verticalSpacing="xs">
            <Table.Tbody>
              {!isLoadingMembers &&
                Array.isArray(members?.data) &&
                members?.data.map((member: any) => (
                  <Table.Tr key={member.email}>
                    <Table.Td>
                      <div>
                        {member.isCurrentUser && (
                          <Badge variant="light" mr="xs" tt="none">
                            You
                          </Badge>
                        )}
                        <span className="text-white fw-bold fs-7">
                          {member.name}
                        </span>
                      </div>
                      <Group mt={4} fz="xs">
                        <div>{member.email}</div>
                        {member.hasPasswordAuth && (
                          <div className="text-slate-300">
                            <i className="bi bi-lock-fill" /> Password Auth
                          </div>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {team.shouldEnforceRBAC && !member.groupName && (
                        <Badge
                          variant="light"
                          color="red"
                          fw="normal"
                          tt="none"
                        >
                          Not Assigned to Group
                        </Badge>
                      )}
                      {member.groupName && (
                        <Badge
                          variant="light"
                          color="green"
                          fw="normal"
                          tt="none"
                        >
                          {member.groupName}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {!member.isCurrentUser && hasAdminAccess && (
                        <Group justify="flex-end" gap="8">
                          <Button
                            size="compact-sm"
                            variant="light"
                            color="red"
                            onClick={() =>
                              setDeleteTeamMemberConfirmationModalData({
                                mode: 'team',
                                id: member._id,
                                email: member.email,
                              })
                            }
                          >
                            Remove
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              {!isLoadingInvitations &&
                Array.isArray(invitations.data) &&
                invitations.data.map((invitation: any) => (
                  <Table.Tr key={invitation.email} className="mt-2">
                    <Table.Td>
                      <span className="text-white fw-bold fs-7">
                        {invitation.email}
                      </span>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="dot" color="gray.6" fw="normal" tt="none">
                        Pending Invite
                      </Badge>
                      <CopyToClipboard text={invitation.url}>
                        <Button size="compact-xs" variant="default" ml="xs">
                          📋 Copy URL
                        </Button>
                      </CopyToClipboard>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {hasAdminAccess && (
                        <Group justify="flex-end" gap="8">
                          <Button
                            size="compact-sm"
                            variant="light"
                            color="red"
                            onClick={() =>
                              setDeleteTeamMemberConfirmationModalData({
                                mode: 'teamInvite',
                                id: invitation._id,
                                email: invitation.email,
                              })
                            }
                          >
                            Delete
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Card.Section>
      </Card>

      <MModal
        centered
        onClose={() => setTeamInviteModalShow(false)}
        opened={teamInviteModalShow}
        title="Invite Team Member"
      >
        <InviteTeamMemberForm
          onSubmit={onSubmitTeamInviteForm}
          isSubmitting={saveTeamInvitation.isPending}
        />
      </MModal>

      <BSModal
        aria-labelledby="contained-modal-title-vcenter"
        centered
        onHide={() =>
          setDeleteTeamMemberConfirmationModalData({
            mode: null,
            id: null,
            email: null,
          })
        }
        show={deleteTeamMemberConfirmationModalData.id != null}
        size="lg"
      >
        <BSModal.Body className="bg-grey rounded">
          <h3 className="text-muted">Delete Team Member</h3>
          <p className="text-muted">
            Deleting this team member (
            {deleteTeamMemberConfirmationModalData.email}) will revoke their
            access to the team&apos;s resources and services. This action is not
            reversible.
          </p>
          <BSButton
            variant="outline-secondary"
            className="mt-2 px-4 ms-2 float-end"
            size="sm"
            onClick={() =>
              setDeleteTeamMemberConfirmationModalData({
                mode: null,
                id: null,
                email: null,
              })
            }
          >
            Cancel
          </BSButton>
          <BSButton
            variant="outline-danger"
            className="mt-2 px-4 float-end"
            size="sm"
            onClick={() =>
              deleteTeamMemberConfirmationModalData.id &&
              onConfirmDeleteTeamMember(
                deleteTeamMemberConfirmationModalData.id,
              )
            }
          >
            Confirm
          </BSButton>
        </BSModal.Body>
      </BSModal>
    </Box>
  );
}

type WebhookForm = {
  name: string;
  url: string;
  service: string;
  description?: string;
  body?: string;
};

export function CreateWebhookForm({
  onClose,
  onSuccess,
}: {
  onClose: VoidFunction;
  onSuccess: (webhookId?: string) => void;
}) {
  const saveWebhook = api.useSaveWebhook();

  const form = useForm<WebhookForm>({
    defaultValues: {
      service: WebhookService.Slack,
    },
  });

  const onSubmit: SubmitHandler<WebhookForm> = async values => {
    const { service, name, url, description, body } = values;
    try {
      const response = await saveWebhook.mutateAsync({
        service,
        name,
        url,
        description: description || '',
        body:
          service === WebhookService.Generic && !body
            ? `{"text": "${DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE}"}`
            : body,
      });
      notifications.show({
        color: 'green',
        message: `Webhook created successfully`,
      });
      onSuccess(response.data?._id);
      onClose();
    } catch (e) {
      console.error(e);
      const message =
        (e instanceof HTTPError ? (await e.response.json())?.message : null) ||
        'Something went wrong. Please contact HyperDX team.';
      notifications.show({
        message,
        color: 'red',
        autoClose: 5000,
      });
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Stack mt="sm">
        <Text>Create Webhook</Text>
        <Radio.Group
          label="Service Type"
          required
          value={form.watch('service')}
          onChange={value => form.setValue('service', value)}
        >
          <Group mt="xs">
            <Radio
              value={WebhookService.Slack}
              label="Slack"
              {...form.register('service', { required: true })}
            />
            <Radio
              value={WebhookService.Generic}
              label="Generic"
              {...form.register('service', { required: true })}
            />
          </Group>
        </Radio.Group>
        <TextInput
          label="Webhook Name"
          placeholder="Post to #dev-alerts"
          required
          error={form.formState.errors.name?.message}
          {...form.register('name', { required: true })}
        />
        <TextInput
          label="Webhook URL"
          placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
          type="url"
          required
          error={form.formState.errors.url?.message}
          {...form.register('url', { required: true })}
        />
        <TextInput
          label="Webhook Description (optional)"
          placeholder="To be used for dev alerts"
          error={form.formState.errors.description?.message}
          {...form.register('description')}
        />
        {form.getValues('service') === WebhookService.Generic && [
          <label className=".mantine-TextInput-label" key="1">
            Webhook Body (optional)
          </label>,
          <div className="mb-2" key="2">
            <CodeMirror
              height="100px"
              extensions={[
                json(),
                linter(jsonLinterWithEmptyCheck()),
                placeholder(
                  `{\n\t"text": "${DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE}"\n}`,
                ),
              ]}
              theme="dark"
              onChange={value => form.setValue('body', value)}
            />
          </div>,
          <Alert
            icon={<i className="bi bi-info-circle-fill text-slate-400" />}
            key="3"
            className="mb-4"
            color="gray"
          >
            <span>
              Currently the body supports the following message template
              variables:
            </span>
            <br />
            <span>
              {DEFAULT_GENERIC_WEBHOOK_BODY.map((body, index) => (
                <span key={index}>
                  <code>{body}</code>
                  {index < DEFAULT_GENERIC_WEBHOOK_BODY.length - 1 && ', '}
                </span>
              ))}
            </span>
          </Alert>,
        ]}
        <Group justify="space-between">
          <Button
            variant="outline"
            type="submit"
            loading={saveWebhook.isPending}
          >
            Add Webhook
          </Button>
          <Button variant="outline" color="gray" onClick={onClose} type="reset">
            Cancel
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function DeleteWebhookButton({
  webhookId,
  webhookName,
  onSuccess,
}: {
  webhookId: string;
  webhookName: string;
  onSuccess: VoidFunction;
}) {
  const confirm = useConfirm();
  const deleteWebhook = api.useDeleteWebhook();

  const handleDelete = async () => {
    if (
      await confirm(
        `Are you sure you want to delete ${webhookName} webhook?`,
        'Delete',
      )
    ) {
      try {
        await deleteWebhook.mutateAsync({ id: webhookId });
        notifications.show({
          color: 'green',
          message: 'Webhook deleted successfully',
        });
        onSuccess();
      } catch (e) {
        console.error(e);
        const message =
          (e instanceof HTTPError
            ? (await e.response.json())?.message
            : null) || 'Something went wrong. Please contact HyperDX team.';
        notifications.show({
          message,
          color: 'red',
          autoClose: 5000,
        });
      }
    }
  };

  return (
    <Button
      color="red"
      size="compact-xs"
      variant="outline"
      onClick={handleDelete}
      loading={deleteWebhook.isPending}
    >
      Delete
    </Button>
  );
}

function IntegrationsSection() {
  const { data: webhookData, refetch: refetchWebhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
  ]);

  const allWebhooks = useMemo(() => {
    return Array.isArray(webhookData?.data) ? webhookData?.data : [];
  }, [webhookData]);

  const [
    isAddWebhookModalOpen,
    { open: openWebhookModal, close: closeWebhookModal },
  ] = useDisclosure();

  return (
    <Box>
      <Text size="md" c="gray.4">
        Integrations
      </Text>
      <Divider my="md" />
      <Card>
        <Text mb="xs">Webhooks</Text>

        <Stack>
          {allWebhooks.map((webhook: any) => (
            <Fragment key={webhook._id}>
              <Group justify="space-between">
                <Stack gap={0}>
                  <Text size="sm">
                    {webhook.name} ({webhook.service})
                  </Text>
                  <Text size="xs" opacity={0.7}>
                    {webhook.url}
                  </Text>
                  {webhook.description && (
                    <Text size="xxs" opacity={0.7}>
                      {webhook.description}
                    </Text>
                  )}
                </Stack>
                <DeleteWebhookButton
                  webhookId={webhook._id}
                  webhookNa
                  me={webhook.name}
                  onSuccess={refetchWebhooks}
                />
              </Group>
              <Divider />
            </Fragment>
          ))}
        </Stack>

        {!isAddWebhookModalOpen ? (
          <Button variant="outline" color="gray.4" onClick={openWebhookModal}>
            Add Webhook
          </Button>
        ) : (
          <CreateWebhookForm
            onClose={closeWebhookModal}
            onSuccess={() => {
              refetchWebhooks();
              closeWebhookModal();
            }}
          />
        )}
      </Card>
    </Box>
  );
}

function TeamNameSection() {
  const { data: team, isLoading, refetch: refetchTeam } = api.useTeam();
  const setTeamName = api.useSetTeamName();
  const { data: me } = api.useMe();
  const hasAdminAccess =
    me?.accountAccess === 'admin' || me?.accountAccess === 'readwrite';
  const [isEditingTeamName, setIsEditingTeamName] = useState(false);
  const form = useForm<WebhookForm>({
    defaultValues: {
      name: team.name,
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
    [refetchTeam, setTeamName, team?.name],
  );
  return (
    <Box>
      <Text size="md" c="gray.4">
        Team Name
      </Text>
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
                variant="light"
                color="green"
                loading={setTeamName.isPending}
              >
                Save
              </Button>
              <Button
                type="button"
                size="xs"
                variant="default"
                disabled={setTeamName.isPending}
                onClick={() => setIsEditingTeamName(false)}
              >
                Cancel
              </Button>
            </Group>
          </form>
        ) : (
          <Group gap="lg">
            <div className="text-slate-300 fs-7">{team.name}</div>
            {hasAdminAccess && (
              <Button
                size="xs"
                variant="default"
                leftSection={<i className="bi bi-pencil text-slate-300" />}
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
          <div className="text-slate-300 ms-2 text-nowrap">
            {copied ? (
              <i className="bi bi-check-lg me-2" />
            ) : (
              <i className="bi bi-clipboard-fill me-2" />
            )}
            {copied ? 'Copied!' : 'Copy'}
          </div>
        }
      >
        <div data-test-id={dataTestId} className="text-wrap text-break">
          {value}
        </div>
      </Button>
    </CopyToClipboard>
  );
};

function ApiKeySection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const hasAdminAccess =
    me?.accountAccess === 'admin' || me?.accountAccess === 'readwrite';
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
    <Box>
      <Text size="md" c="gray.4">
        API Keys
      </Text>
      <Divider my="md" />
      <Card>
        <Text c="gray.3" mb="md">
          Ingestion API Key
        </Text>
        <Group gap="xs">
          {team?.apiKey && (
            <APIKeyCopyButton value={team.apiKey} dataTestId="api-key" />
          )}
          {hasAdminAccess && (
            <Button
              variant="light"
              color="red"
              onClick={() => setRotateApiKeyConfirmationModalShow(true)}
            >
              Rotate API Key
            </Button>
          )}
        </Group>
        <MModal
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
          <MModal.Body>
            <Text size="md">
              Rotating the API key will invalidate your existing API key and
              generate a new one for you. This action is <b>not reversible</b>.
            </Text>
            <Group justify="end">
              <Button
                variant="outline"
                color="gray.5"
                className="mt-2 px-4 ms-2 float-end"
                size="sm"
                onClick={() => setRotateApiKeyConfirmationModalShow(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                color="red.6"
                className="mt-2 px-4 float-end"
                size="sm"
                onClick={onConfirmUpdateTeamApiKey}
              >
                Confirm
              </Button>
            </Group>
          </MModal.Body>
        </MModal>
      </Card>
      {!isLoadingMe && me != null && (
        <Card>
          <Card.Section p="md">
            <Text c="gray.3" mb="md">
              Personal API Access Key
            </Text>
            <APIKeyCopyButton value={me.accessKey} dataTestId="api-key" />
          </Card.Section>
        </Card>
      )}
    </Box>
  );
}

export default function TeamPage() {
  const { data: team, isLoading } = api.useTeam();
  const hasAllowedAuthMethods =
    team?.allowedAuthMethods != null && team?.allowedAuthMethods.length > 0;

  return (
    <div className="TeamPage">
      <Head>
        <title>My Team - HyperDX</title>
      </Head>
      <PageHeader>
        <div>{team?.name || 'My team'}</div>
      </PageHeader>
      <div>
        <Container>
          {isLoading && (
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          )}
          {!isLoading && team != null && (
            <Stack my={20} gap="xl">
              <SourcesSection />
              <ConnectionsSection />
              <IntegrationsSection />
              <TeamNameSection />
              <ApiKeySection />

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
