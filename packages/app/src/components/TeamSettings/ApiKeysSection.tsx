import { useState } from 'react';
import { Trans } from 'next-i18next/pages';
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
        <div data-test-id={dataTestId} className="text-wrap text-break">
          {value}
        </div>
      </Button>
    </CopyToClipboard>
  );
}

export default function ApiKeysSection() {
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
    <Box id="api_keys" data-testid="api-keys-section">
      <Text size="md">
        <Trans>API Keys</Trans>
      </Text>
      <Divider my="md" />
      <Card mb="md">
        <Text mb="md">
          <Trans>Ingestion API Key</Trans>
        </Text>
        <Group gap="xs">
          {team?.apiKey && (
            <APIKeyCopyButton value={team.apiKey} dataTestId="api-key" />
          )}
          {hasAdminAccess && (
            <Button
              data-testid="rotate-api-key-button"
              variant="danger"
              onClick={() => setRotateApiKeyConfirmationModalShow(true)}
            >
              <Trans>Rotate API Key</Trans>
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
              <b>
                <Trans>Rotate API Key</Trans>
              </b>
            </Text>
          }
        >
          <Modal.Body>
            <Text size="md">
              <Trans>
                Rotating the API key will invalidate your existing API key and
                generate a new one for you. This action is
              </Trans>{' '}
              <b>
                <Trans>not reversible</Trans>
              </b>
              .
            </Text>
            <Group justify="end">
              <Button
                data-testid="rotate-api-key-cancel"
                variant="secondary"
                className="mt-2 px-4 ms-2 float-end"
                size="sm"
                onClick={() => setRotateApiKeyConfirmationModalShow(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                data-testid="rotate-api-key-confirm"
                variant="danger"
                className="mt-2 px-4 float-end"
                size="sm"
                onClick={onConfirmUpdateTeamApiKey}
              >
                <Trans>Confirm</Trans>
              </Button>
            </Group>
          </Modal.Body>
        </Modal>
      </Card>
      {!isLoadingMe && me != null && (
        <Card>
          <Card.Section p="md">
            <Text mb="md">
              <Trans>Personal API Access Key</Trans>
            </Text>
            <APIKeyCopyButton value={me.accessKey} dataTestId="api-key" />
          </Card.Section>
        </Card>
      )}
    </Box>
  );
}
