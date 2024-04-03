import { useCallback, useState } from 'react';
import Head from 'next/head';
import {
  Badge,
  Button,
  Container,
  Form,
  Modal,
  Row,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-bootstrap';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { toast } from 'react-toastify';
import { json } from '@codemirror/lang-json';
import { tags as lt } from '@lezer/highlight';
import { Alert } from '@mantine/core';
import { createTheme } from '@uiw/codemirror-themes';
import CodeMirror, { placeholder } from '@uiw/react-codemirror';

import api from './api';
import { withAppNav } from './layout';
import { WebhookFlatIcon } from './SVGIcons';
import { WebhookService } from './types';
import useUserPreferences, { TimeFormat } from './useUserPreferences';
import { isValidJson, isValidUrl } from './utils';

export default function TeamPage() {
  const [
    rotateApiKeyConfirmationModalShow,
    setRotateApiKeyConfirmationModalShow,
  ] = useState(false);
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
  const sendTeamInvite = api.useSendTeamInvite();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const saveWebhook = api.useSaveWebhook();
  const deleteWebhook = api.useDeleteWebhook();
  const setTimeFormat = useUserPreferences().setTimeFormat;
  const timeFormat = useUserPreferences().timeFormat;
  const handleTimeButtonClick = (val: TimeFormat) => setTimeFormat(val);

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
        toast.success('Revoked old API key and generated new key.');
        refetchTeam();
      },
      onError: e => {
        e.response
          .json()
          .then(res => {
            toast.error(res.message, {
              autoClose: 5000,
            });
          })
          .catch(() => {
            toast.error('Something went wrong. Please contact HyperDX team.', {
              autoClose: 5000,
            });
          });
      },
    });
  };

  const onConfirmUpdateTeamApiKey = () => {
    rotateTeamApiKeyAction();
    setRotateApiKeyConfirmationModalShow(false);
  };

  const sendTeamInviteAction = (email: string) => {
    if (email) {
      sendTeamInvite.mutate(
        { email },
        {
          onSuccess: resp => {
            toast.success(
              'Click "Copy URL" and share the URL with your team member',
            );
            refetchInvitations();
          },
          onError: e => {
            e.response
              .json()
              .then(res => {
                toast.error(res.message, {
                  autoClose: 5000,
                });
              })
              .catch(() => {
                toast.error(
                  'Something went wrong. Please contact HyperDX team.',
                  {
                    autoClose: 5000,
                  },
                );
              });
          },
        },
      );
    }
  };

  const onSubmitTeamInviteForm = (e: any) => {
    e.preventDefault();
    const email = e.target[0].value;
    sendTeamInviteAction(email);
    setTeamInviteModalShow(false);
  };

  const onSubmitAddWebhookForm = (e: any, service: WebhookService) => {
    e.preventDefault();
    const name = e.target.name.value;
    const description = e.target.description.value;
    const url = e.target.url.value;

    if (!name) {
      toast.error('Please enter a name for the Generic webhook');
      return;
    }

    if (!url || !isValidUrl(url)) {
      toast.error('Please enter a valid Generic webhook URL');
      return;
    }

    if (headers && !isValidJson(headers)) {
      toast.error('Please enter valid JSON for headers');
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
          toast.success(`Saved ${service} webhook`);
          service === WebhookService.Slack
            ? refetchSlackWebhooks()
            : refetchGenericWebhooks();
        },
        onError: e => {
          e.response
            .json()
            .then(res => {
              toast.error(res.message, {
                autoClose: 5000,
              });
            })
            .catch(() => {
              toast.error(
                'Something went wrong. Please contact HyperDX team.',
                {
                  autoClose: 5000,
                },
              );
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
          toast.success(`Deleted ${service} webhook`);
          service === WebhookService.Slack
            ? refetchSlackWebhooks()
            : refetchGenericWebhooks();
        },
        onError: e => {
          e.response
            .json()
            .then(res => {
              toast.error(res.message, {
                autoClose: 5000,
              });
            })
            .catch(() => {
              toast.error(
                'Something went wrong. Please contact HyperDX team.',
                {
                  autoClose: 5000,
                },
              );
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

  return (
    <Container>
      <Head>
        <title>My Team - HyperDX</title>
      </Head>
      <Row className="mt-5 mb-3">
        <div className="d-flex align-items-center justify-content-between">
          {team != null && <h1 className="text-success">{team.name}</h1>}
          {team == null && <h1>My Team</h1>}
        </div>
      </Row>
      {isLoading && (
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      )}
      {!isLoading && team != null && (
        <>
          <div className="my-4 fs-5">
            <div className="text-muted">Ingestion API Key: </div>
            <Badge bg="primary" data-test-id="apiKey">
              {team.apiKey}
            </Badge>
            <CopyToClipboard text={team.apiKey}>
              <Button
                variant="link"
                className="px-0 text-muted-hover text-decoration-none fs-7 ms-3"
              >
                📋 Copy Key
              </Button>
            </CopyToClipboard>
            <div className="mt-3 mb-5">
              <Button
                variant="outline-danger"
                onClick={() => setRotateApiKeyConfirmationModalShow(true)}
              >
                Rotate API Key
              </Button>
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
                    Rotating the API key will invalidate your existing API key
                    and generate a new one for you. This action is not
                    reversible.
                  </h5>
                  <Button
                    variant="outline-secondary"
                    className="mt-2 px-4 ms-2 float-end"
                    size="sm"
                    onClick={() => setRotateApiKeyConfirmationModalShow(false)}
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
          </div>
          {!isLoadingMe && me != null && (
            <div className="my-4 fs-5">
              <div className="text-muted">Personal API Access Key: </div>
              <Badge bg="primary" data-test-id="apiKey">
                {me.accessKey}
              </Badge>
              <CopyToClipboard text={me.accessKey}>
                <Button
                  variant="link"
                  className="px-0 text-muted-hover text-decoration-none fs-7 ms-3"
                >
                  📋 Copy Key
                </Button>
              </CopyToClipboard>
            </div>
          )}
          <div className="my-5">
            <h2>Slack Webhooks</h2>
            <div className="text-muted">
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
                  <div className="d-flex flex-column mt-3 w-100">
                    <div className="d-flex align-items-center justify-content-between w-100">
                      <div className="d-flex align-items-center">
                        <div className="fw-bold text-white">{webhook.name}</div>
                        <div className="ms-2 me-2">|</div>
                        {/* TODO: truncate long urls responsive width */}
                        <div className="fw-bold text-white">{webhook.url}</div>
                      </div>
                      <Button
                        variant="outline-danger"
                        className="ms-2 align-self-end"
                        size="sm"
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
                </div>
              ))}
            <Button
              className="mt-2 mb-2"
              size="sm"
              variant="light"
              onClick={() => setAddSlackWebhookModalShow(true)}
            >
              <span className="me-1">
                <i className="bi bi-slack" />
              </span>
              Add Slack Incoming Webhook
            </Button>
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
                    variant="brand-primary"
                    className="mt-2 px-4 float-end"
                    type="submit"
                    size="sm"
                  >
                    Add
                  </Button>
                </Form>
              </Modal.Body>
            </Modal>
          </div>

          <div className="my-5">
            <h2>Generic Webhooks</h2>
            {Array.isArray(genericWebhooks?.data) &&
              genericWebhooks.data.length > 0 &&
              genericWebhooks.data.map((webhook: any) => (
                <div key={webhook._id} className="my-3 text-muted">
                  <div className="d-flex flex-column mt-3 w-100">
                    <div className="d-flex align-items-center justify-content-between w-100">
                      <div className="d-flex align-items-center">
                        <div className="fw-bold text-white">{webhook.name}</div>
                        <div className="ms-2 me-2">|</div>
                        {/* TODO: truncate long urls responsive width */}
                        <div className="fw-bold text-white">{webhook.url}</div>
                      </div>
                      <Button
                        variant="outline-danger"
                        className="ms-2"
                        size="sm"
                        onClick={() =>
                          onConfirmDeleteWebhook(
                            webhook._id,
                            WebhookService.Generic,
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
                </div>
              ))}
            <Button
              className="mt-2 mb-2"
              size="sm"
              variant="light"
              onClick={openAddGenericWebhookModal}
            >
              <span
                style={{
                  display: 'flex',
                  gap: '3px',
                }}
              >
                <WebhookFlatIcon width={16} />
                Add Generic Incoming Webhook
              </span>
            </Button>

            <Modal
              aria-labelledby="contained-modal-title-vcenter"
              centered
              onHide={() => setAddGenericWebhookModalShow(false)}
              show={addGenericWebhookModalShow}
              size="lg"
            >
              <Modal.Body className="bg-grey rounded">
                <h5 className="text-muted">Add Generic Incoming Webhook</h5>
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
                      Currently the body supports the following message template
                      variables:
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
                  <Button
                    variant="brand-primary"
                    className="mt-2 px-4 float-end"
                    type="submit"
                    size="sm"
                  >
                    Add
                  </Button>
                </Form>
              </Modal.Body>
            </Modal>
          </div>

          {team.sentryDSN && (
            <div className="my-5">
              <h2>Sentry Integration</h2>
              <div className="mb-2 text-muted">
                To setup Sentry integration, use your Sentry DSN below.
              </div>
              <div>
                <strong>{team.sentryDSN}</strong>
                <CopyToClipboard text={team.sentryDSN}>
                  <Button
                    variant="link"
                    className="px-0 text-muted-hover text-decoration-none fs-7 ms-3"
                  >
                    📋 Copy URL
                  </Button>
                </CopyToClipboard>
              </div>
            </div>
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
          <h2 className="mt-5">Team Members</h2>
          {!isLoadingMembers &&
            Array.isArray(members.data) &&
            members.data.map((member: any) => (
              <div key={member.email} className="mt-2">
                {member.isCurrentUser && (
                  <span className="fw-bold text-primary">(You) </span>
                )}
                {member.name} - {member.email} -
                {member.hasPasswordAuth && ' Password Auth'}
              </div>
            ))}
          {!isLoadingInvitations &&
            Array.isArray(invitations.data) &&
            invitations.data.map((invitation: any) => (
              <div key={invitation.email} className="mt-2">
                {invitation.email} - Pending Invite -
                <CopyToClipboard text={invitation.url}>
                  <Button
                    variant="link"
                    className="px-0 text-muted-hover text-decoration-none fs-7 ms-3"
                  >
                    📋 Copy URL
                  </Button>
                </CopyToClipboard>
              </div>
            ))}
          <div className="mt-3 mb-5">
            <Button
              variant="secondary text-white"
              onClick={() => setTeamInviteModalShow(true)}
            >
              Invite Team Member
            </Button>
            <Modal
              aria-labelledby="contained-modal-title-vcenter"
              centered
              onHide={() => setTeamInviteModalShow(false)}
              show={teamInviteModalShow}
              size="lg"
            >
              <Modal.Body className="bg-grey rounded">
                <h5 className="text-muted">Invite Team Member</h5>
                <Form onSubmit={onSubmitTeamInviteForm}>
                  <Form.Label
                    htmlFor="email"
                    className="text-start text-muted fs-7 mb-2 mt-2"
                  >
                    Email Address
                  </Form.Label>
                  <Form.Control
                    size="sm"
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@company.com"
                    className="border-0 mb-4 px-3"
                  />
                  <Button
                    variant="brand-primary"
                    className="mt-2 px-4 float-end"
                    type="submit"
                    size="sm"
                  >
                    Send Invite
                  </Button>
                </Form>
              </Modal.Body>
            </Modal>
          </div>
          <div className="text-muted my-2">
            Note: Only affects your own view and does not propagate to other
            team members.
          </div>
          <div>
            <h2 className="mt-5">Time Format</h2>
            <ToggleButtonGroup
              type="radio"
              value={timeFormat}
              onChange={handleTimeButtonClick}
              name="buttons"
            >
              <ToggleButton
                id="tbg-btn-1"
                value="24h"
                variant={
                  timeFormat === '24h' ? 'outline-success' : 'outline-secondary'
                }
              >
                24h
              </ToggleButton>
              <ToggleButton
                id="tbg-btn-2"
                value="12h"
                variant={
                  timeFormat === '12h' ? 'outline-success' : 'outline-secondary'
                }
              >
                12h
              </ToggleButton>
            </ToggleButtonGroup>
          </div>
        </>
      )}
    </Container>
  );
}

TeamPage.getLayout = withAppNav;
