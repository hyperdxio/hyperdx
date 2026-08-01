import { useMemo } from 'react';
import { Box, Card, Divider, Text } from '@mantine/core';

import api from '@/api';
import { type DeploymentShape } from '@/components/ClickStackOnboarding/installSnippets';
import McpInstallPanel from '@/components/ClickStackOnboarding/McpInstallPanel';

/**
 * Renders the "Connect your AI Agents" section on the Team
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
 *
 * Auth gating matches `ApiKeysSection`: render nothing until `me`
 * resolves with a non-empty access key. `MeApiResponseSchema`
 * declares `accessKey` as `z.string()`, and the User model
 * generates one on account creation, so the empty-key branch is
 * defensive against a state the schema disallows; we still skip
 * mounting the panel in that case rather than rendering a snippet
 * with an empty bearer.
 */
export default function McpServerSection() {
  const { data: me, isLoading: isLoadingMe } = api.useMe();

  const deployment = useMemo<DeploymentShape | null>(() => {
    if (!me?.accessKey) return null;
    return {
      apiUrl: `${window.location.origin}/api`,
      accessKey: me.accessKey,
    };
  }, [me]);

  if (isLoadingMe || !deployment) {
    return null;
  }

  return (
    <Box id="mcp_server" data-testid="mcp-server-section">
      <Text size="md">Connect your AI Agents</Text>
      <Divider my="md" />
      <Card>
        <McpInstallPanel deployment={deployment} />
      </Card>
    </Box>
  );
}
