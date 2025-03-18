import { FormEventHandler, useCallback, useState } from 'react';
import Head from 'next/head';
import {
  Button,
  Form,
  Modal,
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
  Button as MButton,
  Card,
  Checkbox,
  Container,
  CopyButton,
  Divider,
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
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createTheme } from '@uiw/codemirror-themes';
import CodeMirror, { placeholder } from '@uiw/react-codemirror';

import api from './api';
import { withAppNav } from './layout';
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
      <MButton
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
      </MButton>
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
        <MButton
          variant="light"
          type="submit"
          disabled={!email || isSubmitting}
        >
          Send Invite
        </MButton>
      </Stack>
    </form>
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
  const setTeamName = api.useSetTeamName();

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

  const [isEditingTeamName, setIsEditingTeamName] = useState(false);
  const [editingTeamNameValue, setEditingTeamNameValue] = useState('');
  const handleSetTeamName = useCallback<FormEventHandler<HTMLFormElement>>(
    e => {
      e.stopPropagation();
      e.preventDefault();
      setTeamName.mutate(
        { name: editingTeamNameValue },
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
            setEditingTeamNameValue(team.name);
          },
        },
      );
    },
    [editingTeamNameValue, refetchTeam, setTeamName, team?.name],
  );

  return (
    <div className="TeamPage">
      <Head>
        <title>My Team - HyperDX</title>
      </Head>
      <div className={styles.header}>
        <div>Team Settings</div>
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
              <div className={styles.sectionHeader}>Team Name</div>
              <Card>
                {isEditingTeamName ? (
                  <form onSubmit={handleSetTeamName}>
                    <Group gap="xs">
                      <TextInput
                        size="xs"
                        value={editingTeamNameValue}
                        onChange={e => {
                          setEditingTeamNameValue(e.target.value);
                        }}
                        placeholder="My Team"
                        miw={300}
                        required
                        min={1}
                        max={100}
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            setIsEditingTeamName(false);
                          }
                        }}
                      />
                      <MButton
                        type="submit"
                        size="xs"
                        variant="light"
                        color="green"
                        loading={setTeamName.isLoading}
                      >
                        Save
                      </MButton>
                      <MButton
                        type="button"
                        size="xs"
                        variant="default"
                        disabled={setTeamName.isLoading}
                        onClick={() => setIsEditingTeamName(false)}
                      >
                        Cancel
                      </MButton>
                    </Group>
                  </form>
                ) : (
                  <Group gap="lg">
                    <div className="text-slate-300 fs-7">{team.name}</div>
                    <MButton
                      size="xs"
                      variant="default"
                      leftSection={
                        <i className="bi bi-pencil text-slate-300" />
                      }
                      onClick={() => {
                        setIsEditingTeamName(true);
                        setEditingTeamNameValue(team.name);
                      }}
                    >
                      Change
                    </MButton>
                  </Group>
                )}
              </Card>

              <div className={styles.sectionHeader}>API Keys</div>
              <Card>
                <div className="mb-3 text-slate-300 fs-7">
                  Ingestion API Key
                </div>
                <Group gap="xs">
                  <APIKeyCopyButton value={team.apiKey} dataTestId="api-key" />
                  {hasAdminAccess && (
                    <MButton
                      variant="light"
                      color="red"
                      onClick={() => setRotateApiKeyConfirmationModalShow(true)}
                    >
                      Rotate API Key
                    </MButton>
                  )}
                </Group>
                <div className="">
                  <Modal
                    aria-labelledby="contained-modal-title-vcenter"
                    centered
                    onHide={() => setRotateApiKeyConfirmationModalShow(false)}
                    show={rotateApiKeyConfirmationModalShow}
                    size="lg"
                  >
                    <Modal.Body className="bg-grey rounded">
                      <h3 className="text-muted">Rotate API Key</h3>
                      <h5 className="text-muted">
                        Rotating the API key will invalidate your existing API
                        key and generate a new one for you. This action is not
                        reversible.
                      </h5>
                      <Button
                        variant="outline-secondary"
                        className="mt-2 px-4 ms-2 float-end"
                        size="sm"
                        onClick={() =>
                          setRotateApiKeyConfirmationModalShow(false)
                        }
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="outline-danger"
                        className="mt-2 px-4 float-end"
                        size="sm"
                        onClick={onConfirmUpdateTeamApiKey}
                      >
                        Confirm
                      </Button>
                    </Modal.Body>
                  </Modal>
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
                          <MButton
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
                          </MButton>
                        </div>
                        {webhook.description && (
                          <div className="fw-regular text-muted">
                            {webhook.description}
                          </div>
                        )}
                      </div>
                    ))}

                  <MButton
                    variant="default"
                    leftSection={<i className="bi bi-slack" />}
                    onClick={() => setAddSlackWebhookModalShow(true)}
                  >
                    Add Slack Incoming Webhook
                  </MButton>

                  <Modal
                    aria-labelledby="contained-modal-title-vcenter"
                    centered
                    onHide={() => setAddSlackWebhookModalShow(false)}
                    show={addSlackWebhookModalShow}
                    size="lg"
                  >
                    <Modal.Body className="bg-grey rounded">
                      <h5 className="text-muted">Add Slack Incoming Webhook</h5>
                      <Form
                        onSubmit={e =>
                          onSubmitAddWebhookForm(e, WebhookService.Slack)
                        }
                      >
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Name
                        </Form.Label>
                        <Form.Control
                          size="sm"
                          id="name"
                          name="name"
                          placeholder="My Slack Webhook"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook URL
                        </Form.Label>
                        <Form.Control
                          size="sm"
                          id="url"
                          name="url"
                          placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Description (optional)
                        </Form.Label>
                        <Form.Control
                          size="sm"
                          id="description"
                          name="description"
                          placeholder="A description of this webhook"
                          className="border-0 mb-4 px-3"
                        />
                        <Button
                          variant="success"
                          className="mt-2 px-4 float-end"
                          type="submit"
                          size="sm"
                        >
                          Add
                        </Button>
                      </Form>
                    </Modal.Body>
                  </Modal>
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
                                <MButton
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
                                </MButton>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Card.Section>
                  )}
                <Card.Section p="md">
                  <MButton
                    variant="default"
                    onClick={() => openAddGenericWebhookModal()}
                    leftSection={<WebhookFlatIcon width={16} />}
                  >
                    Add Generic Incoming Webhook
                  </MButton>
                  <Modal
                    aria-labelledby="contained-modal-title-vcenter"
                    centered
                    onHide={() => setAddGenericWebhookModalShow(false)}
                    show={addGenericWebhookModalShow}
                    size="lg"
                  >
                    <Modal.Body className="bg-grey rounded">
                      <h5 className="text-muted">
                        Add Generic Incoming Webhook
                      </h5>
                      <Form
                        onSubmit={e =>
                          onSubmitAddWebhookForm(e, WebhookService.Generic)
                        }
                      >
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Name
                        </Form.Label>
                        <Form.Control
                          size="sm"
                          id="name"
                          name="name"
                          placeholder="My Webhook"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook URL
                        </Form.Label>
                        <Form.Control
                          size="sm"
                          id="url"
                          name="url"
                          placeholder="https://webhook.site/6fd51408-4277-455b-aaf2-a50be9b4866b"
                          className="border-0 mb-4 px-3"
                          required
                        />
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Webhook Description (optional)
                        </Form.Label>
                        <Form.Control
                          size="sm"
                          id="description"
                          name="description"
                          placeholder="A description of this webhook"
                          className="border-0 mb-4 px-3"
                        />
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Custom Headers (optional)
                        </Form.Label>
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
                        <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                          Custom Body (optional)
                        </Form.Label>

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
                        <MButton variant="light" type="submit" size="sm">
                          Add
                        </MButton>
                      </Form>
                    </Modal.Body>
                  </Modal>
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
              <Modal
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
                <Modal.Body className="bg-grey rounded">
                  <h3 className="text-muted">Delete Team Member</h3>
                  <p className="text-muted">
                    Deleting this team member (
                    {deleteTeamMemberConfirmationModalData.email}) will revoke
                    their access to the team&apos;s resources and services. This
                    action is not reversible.
                  </p>
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                </Modal.Body>
              </Modal>

              <div className={styles.sectionHeader}>Team</div>

              <Card>
                <Card.Section withBorder py="sm" px="lg">
                  <Group align="center" justify="space-between">
                    <div className="text-slate-300 fs-7">Team Members</div>
                    <MButton
                      variant="light"
                      leftSection={<i className="bi bi-person-plus-fill" />}
                      onClick={() => setTeamInviteModalShow(true)}
                    >
                      Invite Team Member
                    </MButton>
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
                                  <MButton
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
                                  </MButton>
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
                                <MButton
                                  size="compact-xs"
                                  variant="default"
                                  ml="xs"
                                >
                                  📋 Copy URL
                                </MButton>
                              </CopyToClipboard>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>
                              {hasAdminAccess && (
                                <Group justify="flex-end" gap="8">
                                  <MButton
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
                                  </MButton>
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
                  isSubmitting={saveTeamInvitation.isLoading}
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
