import { useCallback, useState } from 'react';
import Head from 'next/head';
import { HTTPError } from 'ky';
import {
  Button as BSButton,
  Form as BSForm,
  Modal as BSModal,
  Row,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-bootstrap';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { json } from '@codemirror/lang-json';
import { tags as lt } from '@lezer/highlight';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  CopyButton,
  Divider,
  Flex,
  Group,
  Modal as MModal,
  NativeSelect,
  Notification,
  NumberInput,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createTheme } from '@uiw/codemirror-themes';
import CodeMirror, { placeholder } from '@uiw/react-codemirror';

import { ConnectionForm } from '@/components/ConnectionForm';
import { TableSourceForm } from '@/components/SourceForm';
import { IS_LOCAL_MODE } from '@/config';

import api from './api';
import { useConnections } from './connection';
import { withAppNav } from './layout';
import { useSources } from './source';
import { WebhookFlatIcon } from './SVGIcons';
import { WebhookService } from './types';
import { truncateMiddle } from './utils';
import { isValidJson, isValidUrl } from './utils';

import styles from '../styles/TeamPage.module.scss';

const APIKeyCopyButton = ({
  value,
  dataTestId,
}: {
  value: string;
  dataTestId?: string;
}) => (
  <CopyButton value={value}>
    {({ copy, copied }) => (
      <Button
        onClick={copy}
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
    )}
  </CopyButton>
);

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
                    {s.kind === 'log' ? 'Logs' : 'Metrics'}
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

export default function TeamPage() {
  const [
    rotateApiKeyConfirmationModalShow,
    setRotateApiKeyConfirmationModalShow,
  ] = useState(false);
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
  const [teamInviteUrl, setTeamInviteUrl] = useState('');
  const [addSlackWebhookModalShow, setAddSlackWebhookModalShow] =
    useState(false);
  const [addGenericWebhookModalShow, setAddGenericWebhookModalShow] =
    useState(false);
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const { data: team, isLoading, refetch: refetchTeam } = api.useTeam();
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
  const { data: slackWebhooks, refetch: refetchSlackWebhooks } =
    api.useWebhooks(['slack']);
  const { data: genericWebhooks, refetch: refetchGenericWebhooks } =
    api.useWebhooks(['generic']);
  const saveTeamInvitation = api.useSaveTeamInvitation();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const deleteTeamMember = api.useDeleteTeamMember();
  const deleteTeamInvitation = api.useDeleteTeamInvitation();
  const saveWebhook = api.useSaveWebhook();
  const deleteWebhook = api.useDeleteWebhook();

  const hasAdminAccess = true;

  //   Generic Webhook Form State
  const [headers, setHeaders] = useState<string>();
  const onHeadersChange = useCallback(
    (headers: string) => {
      setHeaders(headers);
    },
    [setHeaders],
  );
  const [body, setBody] = useState<string>();
  const onBodyChange = useCallback(
    (body: string) => {
      setBody(body);
    },
    [setBody],
  );

  const hasAllowedAuthMethods =
    team?.allowedAuthMethods != null && team?.allowedAuthMethods.length > 0;

  const rotateTeamApiKeyAction = () => {
    rotateTeamApiKey.mutate(undefined, {
      onSuccess: resp => {
        notifications.show({
          color: 'green',
          message: 'Revoked old API key and generated new key.',
        });
        refetchTeam();
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
                message: 'Something went wrong. Please contact HyperDX team.',
                autoClose: 5000,
              });
            });
        }
      },
    });
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

  const onConfirmUpdateTeamApiKey = () => {
    rotateTeamApiKeyAction();
    setRotateApiKeyConfirmationModalShow(false);
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

  const onSubmitTeamInviteForm = ({ email }: { email: string }) => {
    sendTeamInviteAction(email);
    setTeamInviteModalShow(false);
  };

  const onSubmitAddWebhookForm = (e: any, service: WebhookService) => {
    e.preventDefault();
    const name = e.target.name.value;
    const description = e.target.description.value;
    const url = e.target.url.value;

    if (!name) {
      notifications.show({
        color: 'red',
        message: 'Please enter a name for the Generic webhook',
      });
      return;
    }

    if (!url || !isValidUrl(url)) {
      notifications.show({
        color: 'red',
        message: 'Please enter a valid Generic webhook URL',
      });
      return;
    }

    if (headers && !isValidJson(headers)) {
      notifications.show({
        color: 'red',
        message: 'Please enter valid JSON for headers',
      });
      return;
    }

    saveWebhook.mutate(
      {
        name,
        service: service,
        url,
        description,
        headers: headers ? JSON.parse(headers) : undefined,
        body,
      },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: `Saved ${service} webhook`,
          });
          service === WebhookService.Slack
            ? refetchSlackWebhooks()
            : refetchGenericWebhooks();
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
                  message: 'Something went wrong. Please contact HyperDX team.',

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
    service === WebhookService.Slack
      ? setAddSlackWebhookModalShow(false)
      : setAddGenericWebhookModalShow(false);
  };

  const onConfirmDeleteWebhook = (
    webhookId: string,
    service: WebhookService,
  ) => {
    // TODO: DELETES SHOULD POTENTIALLY WATERFALL DELETE TO ALERTS THAT CONSUME THEM
    deleteWebhook.mutate(
      {
        id: webhookId,
      },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: `Deleted ${service} webhook`,
          });
          service === WebhookService.Slack
            ? refetchSlackWebhooks()
            : refetchGenericWebhooks();
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
                  message: 'Something went wrong. Please contact HyperDX team.',

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
  };

  const openAddGenericWebhookModal = () => {
    setHeaders(undefined);
    setBody(undefined);
    setAddGenericWebhookModalShow(true);
  };

  const hdxJSONTheme = createTheme({
    theme: 'dark',
    settings: {
      background: '#FFFFFF1A',
      foreground: '#f8f8f2',
      caret: '#50fa7b',
      selection: '#4a4eb5',
      selectionMatch: '#9357ff',
      lineHighlight: '#8a91991a',
      gutterBackground: '#1a1d23',
      gutterForeground: '#8a919966',
    },
    styles: [
      { tag: [lt.propertyName], color: '#bb9af7' },
      { tag: [lt.string], color: '#4bb74a' },
      { tag: [lt.number], color: '#ff5d5b' },
      { tag: [lt.bool], color: '#3788f6' },
    ],
  });

  return (
    <div className="TeamPage">
      <Head>
        <title>My Team - HyperDX</title>
      </Head>
      <div className={styles.header}>
        <div>{team?.name || 'My team'}</div>
      </div>
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
              <div className={styles.sectionHeader}>API Keys</div>
              <Card>
                <div className="mb-3 text-slate-300 fs-7">
                  Ingestion API Key
                </div>
                <Group gap="xs">
                  <APIKeyCopyButton value={team.apiKey} dataTestId="api-key" />
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
                <div className="">
                  <BSModal
                    aria-labelledby="contained-modal-title-vcenter"
                    centered
                    onHide={() => setRotateApiKeyConfirmationModalShow(false)}
                    show={rotateApiKeyConfirmationModalShow}
                    size="lg"
                  >
                    <BSModal.Body className="bg-grey rounded">
                      <h3 className="text-muted">Rotate API Key</h3>
                      <h5 className="text-muted">
                        Rotating the API key will invalidate your existing API
                        key and generate a new one for you. This action is not
                        reversible.
                      </h5>
                      <BSButton
                        variant="outline-secondary"
                        className="mt-2 px-4 ms-2 float-end"
                        size="sm"
                        onClick={() =>
                          setRotateApiKeyConfirmationModalShow(false)
                        }
                      >
                        Cancel
                      </BSButton>
                      <BSButton
                        variant="outline-danger"
                        className="mt-2 px-4 float-end"
                        size="sm"
                        onClick={onConfirmUpdateTeamApiKey}
                      >
                        Confirm
                      </BSButton>
                    </BSModal.Body>
                  </BSModal>
                </div>
              </Card>
              {!isLoadingMe && me != null && (
                <Card>
                  <Card.Section p="md">
                    <div className="mb-3 text-slate-300 fs-7">
                      Personal API Access Key
                    </div>
                    <APIKeyCopyButton
                      value={me.accessKey}
                      dataTestId="api-key"
                    />
                  </Card.Section>
                </Card>
              )}

              <div className={styles.sectionHeader}>Integrations</div>
              <Card>
                <Card.Section p="md">
                  <div className="mb-1 text-slate-300 fs-7">Slack Webhooks</div>

                  <div className="text-slate-400 fs-8 mb-3">
                    Learn how to set up a Slack webhook{' '}
                    <a
                      href="https://api.slack.com/messaging/webhooks"
                      target="_blank"
                      rel="noreferrer"
                    >
                      here.
                    </a>
                  </div>

                  {Array.isArray(slackWebhooks?.data) &&
                    slackWebhooks.data.length > 0 &&
                    slackWebhooks.data.map((webhook: any) => (
                      <div key={webhook._id} className="my-3 text-muted">
                        <div className="d-flex mt-3 align-items-center">
                          <div className="fw-bold text-white">
                            {webhook.name}
                          </div>
                          <div className="ms-2 me-2">|</div>
                          <div className="fw-bold text-white">
                            {webhook.url}
                          </div>
                          <Button
                            ml="xs"
                            variant="light"
                            color="red"
                            size="compact-sm"
                            onClick={() =>
                              onConfirmDeleteWebhook(
                                webhook._id,
                                WebhookService.Slack,
                              )
                            }
                          >
                            Delete
                          </Button>
                        </div>
                        {webhook.description && (
                          <div className="fw-regular text-muted">
                            {webhook.description}
                          </div>
                        )}
                      </div>
                    ))}

                  <Button
                    variant="default"
                    leftSection={<i className="bi bi-slack" />}
                    onClick={() => setAddSlackWebhookModalShow(true)}
                  >
                    Add Slack Incoming Webhook
                  </Button>

                  <BSModal
                    aria-labelledby="contained-modal-title-vcenter"
                    centered
                    onHide={() => setAddSlackWebhookModalShow(false)}
                    show={addSlackWebhookModalShow}
                    size="lg"
                  >
                    <BSModal.Body className="bg-grey rounded">
                      <h5 className="text-muted">Add Slack Incoming Webhook</h5>
                      <BSForm
                        onSubmit={e =>
                          onSubmitAddWebhookForm(e, WebhookService.Slack)
                        }
                      >
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Name
                        </BSForm.Label>
                        <BSForm.Control
                          size="sm"
                          id="name"
                          name="name"
                          placeholder="My Slack Webhook"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook URL
                        </BSForm.Label>
                        <BSForm.Control
                          size="sm"
                          id="url"
                          name="url"
                          placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Description (optional)
                        </BSForm.Label>
                        <BSForm.Control
                          size="sm"
                          id="description"
                          name="description"
                          placeholder="A description of this webhook"
                          className="border-0 mb-4 px-3"
                        />
                        <BSButton
                          variant="success"
                          className="mt-2 px-4 float-end"
                          type="submit"
                          size="sm"
                        >
                          Add
                        </BSButton>
                      </BSForm>
                    </BSModal.Body>
                  </BSModal>
                </Card.Section>
              </Card>

              <Card>
                <Card.Section p="md" withBorder>
                  <div className="text-slate-300 fs-7">Generic Webhooks</div>
                </Card.Section>
                {Array.isArray(genericWebhooks?.data) &&
                  genericWebhooks.data.length > 0 && (
                    <Card.Section withBorder>
                      <Table horizontalSpacing="lg" verticalSpacing="xs">
                        <Table.Tbody>
                          {genericWebhooks.data.map((webhook: any) => (
                            <Table.Tr key={webhook._id}>
                              <Table.Td>
                                <div className="fw-bold">{webhook.name}</div>
                                {webhook.description && (
                                  <div className="fw-regular text-muted">
                                    {webhook.description}
                                  </div>
                                )}
                              </Table.Td>
                              <Table.Td>
                                <Tooltip
                                  label={webhook.url}
                                  color="dark"
                                  className="fs-8.5"
                                >
                                  <span className="fs-8">
                                    {truncateMiddle(webhook.url, 70)}
                                  </span>
                                </Tooltip>
                              </Table.Td>
                              <Table.Td align="right">
                                <Button
                                  ml="xs"
                                  variant="light"
                                  color="red"
                                  size="compact-sm"
                                  onClick={() =>
                                    onConfirmDeleteWebhook(
                                      webhook._id,
                                      WebhookService.Generic,
                                    )
                                  }
                                >
                                  Delete
                                </Button>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Card.Section>
                  )}
                <Card.Section p="md">
                  <Button
                    variant="default"
                    onClick={() => openAddGenericWebhookModal()}
                    leftSection={<WebhookFlatIcon width={16} />}
                  >
                    Add Generic Incoming Webhook
                  </Button>
                  <BSModal
                    aria-labelledby="contained-modal-title-vcenter"
                    centered
                    onHide={() => setAddGenericWebhookModalShow(false)}
                    show={addGenericWebhookModalShow}
                    size="lg"
                  >
                    <BSModal.Body className="bg-grey rounded">
                      <h5 className="text-muted">
                        Add Generic Incoming Webhook
                      </h5>
                      <BSForm
                        onSubmit={e =>
                          onSubmitAddWebhookForm(e, WebhookService.Generic)
                        }
                      >
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Name
                        </BSForm.Label>
                        <BSForm.Control
                          size="sm"
                          id="name"
                          name="name"
                          placeholder="My Webhook"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook URL
                        </BSForm.Label>
                        <BSForm.Control
                          size="sm"
                          id="url"
                          name="url"
                          placeholder="https://webhook.site/6fd51408-4277-455b-aaf2-a50be9b4866b"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Description (optional)
                        </BSForm.Label>
                        <BSForm.Control
                          size="sm"
                          id="description"
                          name="description"
                          placeholder="A description of this webhook"
                          className="border-0 mb-4 px-3"
                        />
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Custom Headers (optional)
                        </BSForm.Label>
                        <div className="mb-4">
                          <CodeMirror
                            value={headers}
                            height="100px"
                            extensions={[
                              json(),
                              placeholder(
                                '{\n\t"Content-Type": "application/json",\n}',
                              ),
                            ]}
                            theme={hdxJSONTheme}
                            onChange={onHeadersChange}
                          />
                        </div>
                        <BSForm.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Custom Body (optional)
                        </BSForm.Label>

                        <div className="mb-2">
                          <CodeMirror
                            value={body}
                            height="100px"
                            extensions={[
                              json(),
                              placeholder('{\n\t"text": "{{body}}"\n}'),
                            ]}
                            theme={hdxJSONTheme}
                            onChange={onBodyChange}
                          />
                        </div>

                        <Alert
                          icon={
                            <i className="bi bi-info-circle-fill text-slate-400" />
                          }
                          className="mb-4"
                          color="gray"
                        >
                          <span>
                            Currently the body supports the following message
                            template variables:
                          </span>
                          <br />
                          <span>
                            <code>
                              {'{{'}link{'}}'}
                            </code>
                            ,{' '}
                            <code>
                              {'{{'}title{'}}'}
                            </code>
                            ,{' '}
                            <code>
                              {'{{'}body{'}}'}
                            </code>
                          </span>
                        </Alert>
                        <Button variant="light" type="submit" size="sm">
                          Add
                        </Button>
                      </BSForm>
                    </BSModal.Body>
                  </BSModal>
                </Card.Section>
              </Card>

              {team.sentryDSN && (
                <Card>
                  <Card.Section p="md">
                    <div className="mb-2 text-slate-300 fs-7">
                      Sentry Integration
                    </div>
                    <div className="mb-2 text-slate-300 fs-8">
                      To setup Sentry integration, use your Sentry DSN below.
                    </div>
                    <APIKeyCopyButton
                      value={team.sentryDSN}
                      dataTestId="sentry-dsn"
                    />
                  </Card.Section>
                </Card>
              )}

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
                    {deleteTeamMemberConfirmationModalData.email}) will revoke
                    their access to the team&apos;s resources and services. This
                    action is not reversible.
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

              <div className={styles.sectionHeader}>Team</div>

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
                                  <Badge variant="light" mr={4} tt="none">
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
                                    <i className="bi bi-lock-fill" /> Password
                                    Auth
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
                                    Delete
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
                              <Badge
                                variant="dot"
                                color="gray.6"
                                fw="normal"
                                tt="none"
                              >
                                Pending Invite
                              </Badge>
                              <CopyToClipboard text={invitation.url}>
                                <Button
                                  size="compact-xs"
                                  variant="default"
                                  ml="xs"
                                >
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
            </Stack>
          )}
        </Container>
      </div>
    </div>
  );
}

TeamPage.getLayout = withAppNav;
