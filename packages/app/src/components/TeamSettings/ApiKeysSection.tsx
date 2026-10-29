import { Box, Button, Card, Divider, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import { RevealSnippet } from '@/components/RevealSnippet/RevealSnippet';
import { useConfirm } from '@/useConfirm';

// The reveal Input fills its container, so cap its width here at the parent.
const KEY_FIELD_MAX_WIDTH = 420;

/** Masked, read-only API-key field with an inline reveal eye and copy icon. */
function APIKeyCopyButton({
  value,
  dataTestId,
  ariaLabel,
}: {
  value: string;
  dataTestId?: string;
  ariaLabel?: string;
}) {
  return (
    <RevealSnippet value={value} secrets={[value]}>
      <RevealSnippet.Input
        aria-label={ariaLabel}
        data-testid={dataTestId}
        revealLabel="Reveal key"
        copyLabel="Copy key"
      />
    </RevealSnippet>
  );
}

export default function ApiKeysSection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const rotatePersonalAccessKey = api.useRotatePersonalAccessKey();
  const confirm = useConfirm();
  const hasAdminAccess = true;

  // `confirm` resolves exactly once, so a double click on its Confirm button
  // during the modal's exit transition cannot fire a second rotation.
  const onRotateTeamApiKey = async () => {
    const confirmed = await confirm(
      <>
        Rotating the API key will invalidate your existing API key and generate
        a new one for you. This action is <b>not reversible</b>.
      </>,
      'Rotate key',
      { variant: 'danger' },
    );
    if (!confirmed) {
      return;
    }

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

  const onRotateAccessKey = async () => {
    const confirmed = await confirm(
      <>
        Rotating your personal access key immediately revokes the current one
        and generates a new one. This action is <b>not reversible</b>. Anything
        still using the old key will start failing with 401 until you update it,
        including MCP / AI agent configs (Claude Code, Cursor, VS Code, Codex),
        external API v2 clients, Terraform / IaC providers, and CI scripts. Your
        browser session is not affected; you will stay signed in.
      </>,
      'Rotate key',
      { variant: 'danger' },
    );
    if (!confirmed) {
      return;
    }

    rotatePersonalAccessKey.mutate(undefined, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message:
            'Revoked your old personal access key and generated a new one.',
        });
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
      <Text size="md">API keys</Text>
      <Divider my="md" />
      <Card mb="md">
        <Text mb="md">Ingestion API key</Text>
        <Group gap="xs" align="flex-start" wrap="nowrap">
          {team?.apiKey && (
            <Box flex={1} miw={0} maw={KEY_FIELD_MAX_WIDTH}>
              <APIKeyCopyButton
                value={team.apiKey}
                dataTestId="ingestion-api-key"
                ariaLabel="Ingestion API key"
              />
            </Box>
          )}
          {hasAdminAccess && (
            <Button
              data-testid="rotate-api-key-button"
              variant="danger"
              onClick={onRotateTeamApiKey}
            >
              Rotate API key
            </Button>
          )}
        </Group>
      </Card>
      {!isLoadingMe && me != null && (
        <Card>
          <Card.Section p="md">
            <Text mb="md">Personal API access key</Text>
            <Group gap="xs" align="flex-start" wrap="nowrap">
              <Box flex={1} miw={0} maw={KEY_FIELD_MAX_WIDTH}>
                <APIKeyCopyButton
                  value={me.accessKey}
                  dataTestId="personal-access-key"
                  ariaLabel="Personal API access key"
                />
              </Box>
              <Button
                data-testid="rotate-access-key-button"
                variant="danger"
                onClick={onRotateAccessKey}
              >
                Rotate access key
              </Button>
            </Group>
          </Card.Section>
        </Card>
      )}
    </Box>
  );
}
