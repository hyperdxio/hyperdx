import { type ReactNode, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Box, Button, Card, Divider, Group, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconClipboard } from '@tabler/icons-react';

import api from '@/api';

function APIKeyCopyButton({
  value,
  dataTestId,
}: {
  value: string;
  dataTestId?: string;
}) {
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
        <div data-testid={dataTestId} className="text-wrap text-break">
          {value}
        </div>
      </Button>
    </CopyToClipboard>
  );
}

function RotateKeyConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  testIdPrefix,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /**
   * Yields `${prefix}-modal`, `-cancel` and `-confirm`. The ingestion flow
   * passes `rotate-api-key` to preserve the testids that
   * tests/e2e/page-objects/TeamPage.ts already depends on.
   */
  testIdPrefix: string;
  children: ReactNode;
}) {
  return (
    <Modal
      centered
      data-testid={`${testIdPrefix}-modal`}
      onClose={onClose}
      opened={opened}
      size="lg"
      title={
        <Text size="xl">
          <b>{title}</b>
        </Text>
      }
    >
      <Modal.Body>
        {children}
        <Group justify="end">
          <Button
            data-testid={`${testIdPrefix}-cancel`}
            variant="secondary"
            className="mt-2 px-4 ms-2 float-end"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            data-testid={`${testIdPrefix}-confirm`}
            variant="danger"
            className="mt-2 px-4 float-end"
            size="sm"
            onClick={onConfirm}
          >
            Confirm
          </Button>
        </Group>
      </Modal.Body>
    </Modal>
  );
}

export default function ApiKeysSection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const { data: me, isLoading: isLoadingMe, refetch: refetchMe } = api.useMe();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const rotatePersonalAccessKey = api.useRotatePersonalAccessKey();
  const hasAdminAccess = true;
  const [
    rotateApiKeyConfirmationModalShow,
    setRotateApiKeyConfirmationModalShow,
  ] = useState(false);
  const [
    rotateAccessKeyConfirmationModalShow,
    setRotateAccessKeyConfirmationModalShow,
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

  const onConfirmRotateAccessKey = () => {
    setRotateAccessKeyConfirmationModalShow(false);
    rotatePersonalAccessKey.mutate(undefined, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message:
            'Revoked your old personal access key and generated a new one.',
        });
        refetchMe();
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

  return (
    <Box id="api_keys" data-testid="api-keys-section">
      <Text size="md">API Keys</Text>
      <Divider my="md" />
      <Card mb="md">
        <Text mb="md">Ingestion API Key</Text>
        <Group gap="xs">
          {team?.apiKey && (
            <APIKeyCopyButton
              value={team.apiKey}
              dataTestId="ingestion-api-key"
            />
          )}
          {hasAdminAccess && (
            <Button
              data-testid="rotate-api-key-button"
              variant="danger"
              onClick={() => setRotateApiKeyConfirmationModalShow(true)}
            >
              Rotate API Key
            </Button>
          )}
        </Group>
        <RotateKeyConfirmModal
          opened={rotateApiKeyConfirmationModalShow}
          onClose={() => setRotateApiKeyConfirmationModalShow(false)}
          onConfirm={onConfirmUpdateTeamApiKey}
          title="Rotate API Key"
          testIdPrefix="rotate-api-key"
        >
          <Text size="md">
            Rotating the API key will invalidate your existing API key and
            generate a new one for you. This action is <b>not reversible</b>.
          </Text>
        </RotateKeyConfirmModal>
      </Card>
      {!isLoadingMe && me != null && (
        <Card>
          <Card.Section p="md">
            <Text mb="md">Personal API Access Key</Text>
            <Group gap="xs">
              <APIKeyCopyButton
                value={me.accessKey}
                dataTestId="personal-access-key"
              />
              <Button
                data-testid="rotate-access-key-button"
                variant="danger"
                onClick={() => setRotateAccessKeyConfirmationModalShow(true)}
              >
                Rotate Access Key
              </Button>
            </Group>
            <RotateKeyConfirmModal
              opened={rotateAccessKeyConfirmationModalShow}
              onClose={() => setRotateAccessKeyConfirmationModalShow(false)}
              onConfirm={onConfirmRotateAccessKey}
              title="Rotate Personal API Access Key"
              testIdPrefix="rotate-access-key"
            >
              <Text size="md">
                Rotating your personal access key immediately revokes the
                current one and generates a new one. This action is{' '}
                <b>not reversible</b>.
              </Text>
              <Text size="md" mt="sm">
                Anything still using the old key will start failing with 401
                until you update it — MCP / AI agent configs (Claude Code,
                Cursor, VS Code, Codex), external API v2 clients, Terraform /
                IaC providers, and CI scripts. Your browser session is not
                affected; you will stay signed in.
              </Text>
            </RotateKeyConfirmModal>
          </Card.Section>
        </Card>
      )}
    </Box>
  );
}
