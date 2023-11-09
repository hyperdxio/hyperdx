import Head from 'next/head';
import Link from 'next/link';
import {
  Badge,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  ButtonGroup,
  Container,
  Form,
  Modal,
  Row,
  Spinner,
} from 'react-bootstrap';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { toast } from 'react-toastify';
import { useState } from 'react';
import useUserPreferences from './useUserPreferences';
import { TimeFormat } from './useUserPreferences';
import AppNav from './AppNav';
import api from './api';
import { isValidUrl } from './utils';
export default function TeamPage() {
  const [
    rotateApiKeyConfirmationModalShow,
    setRotateApiKeyConfirmationModalShow,
  ] = useState(false);
  const [teamInviteModalShow, setTeamInviteModalShow] = useState(false);
  const [teamInviteUrl, setTeamInviteUrl] = useState('');
  const [addSlackWebhookModalShow, setAddSlackWebhookModalShow] =
    useState(false);
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const { data: team, isLoading, refetch: refetchTeam } = api.useTeam();
  const { data: slackWebhooks, refetch: refetchSlackWebhooks } =
    api.useWebhooks('slack');
  const sendTeamInvite = api.useSendTeamInvite();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const saveWebhook = api.useSaveWebhook();
  const deleteWebhook = api.useDeleteWebhook();
  const setTimeFormat = useUserPreferences().setTimeFormat
  const timeFormat = useUserPreferences().timeFormat
  
  console.log(`timeFormat: ${timeFormat}`)
  const handleTimeButtonClick = (val: TimeFormat) => setTimeFormat(val)

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

  const onSubmitAddSlackWebhookForm = (e: any) => {
    e.preventDefault();
    const name = e.target[0].value;
    const url = e.target[1].value;
    if (!name) {
      toast.error('Please enter a name for the Slack webhook');
      return;
    }
    if (!url || !isValidUrl(url) || !url.includes('hooks.slack.com')) {
      toast.error('Please enter a valid Slack webhook URL');
      return;
    }
    saveWebhook.mutate(
      { name, service: 'slack', url },
      {
        onSuccess: () => {
          toast.success('Saved Slack webhook');
          refetchSlackWebhooks();
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
    setAddSlackWebhookModalShow(false);
  };

  const onConfirmDeleteSlackWebhook = (webhookId: string) => {
    deleteWebhook.mutate(
      {
        id: webhookId,
      },
      {
        onSuccess: () => {
          toast.success('Deleted Slack webhook');
          refetchSlackWebhooks();
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

  return (
    <div className="TeamPage">
      <Head>
        <title>My Team - HyperDX</title>
      </Head>
      <div className="d-flex">
        <AppNav fixed />
        <Container>
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
              </div>
              <div className="my-5">
                <h2>Slack Webhooks</h2>
                <div className="text-muted">
                  Lean how to set up a Slack webhook{' '}
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
                        <div className="fw-bold text-white">{webhook.name}</div>
                        <div className="ms-2 me-2">|</div>
                        <div className="fw-bold text-white">{webhook.url}</div>
                        <Button
                          variant="outline-danger"
                          className="ms-2"
                          size="sm"
                          onClick={() =>
                            onConfirmDeleteSlackWebhook(webhook._id)
                          }
                        >
                          Delete
                        </Button>
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
                    <Form onSubmit={onSubmitAddSlackWebhookForm}>
                      <Form.Label className="text-start text-muted fs-7 mb-2 mt-2">
                        Webhook Name
                      </Form.Label>
                      <Form.Control
                        size="sm"
                        id="name"
                        name="name"
                        placeholder="My Slack Webhook"
                        className="border-0 mb-4 px-3"
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
              {team.users.map((user: any) => (
                <div key={user.email} className="mt-2">
                  {user.isCurrentUser && (
                    <span className="fw-bold text-primary">(You) </span>
                  )}
                  {user.name} - {user.email} -
                  {user.hasPasswordAuth && ' Password Auth'}
                </div>
              ))}
              {team.teamInvites.map((teamInvite: any) => (
                <div key={teamInvite.email} className="mt-2">
                  {teamInvite.email} - Pending Invite -
                  <CopyToClipboard text={teamInvite.url}>
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
              <div>
                <h2 className="mt-5">Time Format</h2>
                  <ToggleButtonGroup type="radio" value={timeFormat} onChange={handleTimeButtonClick} name="buttons">
                    <ToggleButton id="tbg-btn-1" value='24h'>
                      24h
                    </ToggleButton>
                    <ToggleButton id="tbg-btn-2" value='12h'>
                      12h
                    </ToggleButton>
                  </ToggleButtonGroup>
              </div>
            </>
          )}
        </Container>
      </div>
    </div>
  );
}
