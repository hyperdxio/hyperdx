import { useMemo } from 'react';
import { Box, Card, Divider, Text } from '@mantine/core';

import api from '@/api';

import { type DeploymentShape } from '../ClickStackOnboarding/installSnippets';
import McpInstallPanel from '../ClickStackOnboarding/McpInstallPanel';

function getApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/api`;
}

/**
 * Renders the "Connect your AI assistant" section on the Team
 * Settings page (Integrations tab). Self-managed OSS deployments
 * mount the MCP server at `<origin>/api/mcp` with the per-user
 * access key as bearer; the MCP server resolves the active team
 * from the token, so the install snippet doesn't need to encode
 * tenant context on the client.
 *
 * Structure mirrors `IntegrationsSection.tsx` and
 * `ApiKeysSection.tsx`: outer `<Box>` with a `<Text size="md">`
 * header and `<Divider />`, then a single `<Card>` wrapping the
 * install panel. No subtitle below the header so the visual
 * rhythm matches the rest of the Integrations tab.
 */
export default function McpServerSection() {
  const { data: me, isLoading: isLoadingMe } = api.useMe();

  const deployment = useMemo<DeploymentShape | null>(() => {
    if (!me) return null;
    return {
      apiUrl: getApiOrigin(),
      accessKey: me.accessKey ?? '',
    };
  }, [me]);

  // Wait for `me` before mounting the panel: the deployment shape
  // depends on `me.accessKey`, and rendering mid-load would briefly
  // emit the "Sign in to load your personal access key" alert path
  // before the cache hydrates.
  if (isLoadingMe) {
    return null;
  }

  return (
    <Box id="mcp_server" data-testid="mcp-server-section">
      <Text size="md">Connect your AI assistant</Text>
      <Divider my="md" />
      <Card>
        <McpInstallPanel deployment={deployment} />
      </Card>
    </Box>
  );
}
