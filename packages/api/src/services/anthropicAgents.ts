import { serializeError } from 'serialize-error';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import AnthropicIntegration from '@/models/anthropicIntegration';
import ManagedAgent from '@/models/managedAgent';
import { decrypt } from '@/utils/encryption';
import logger from '@/utils/logger';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'managed-agents-2026-04-01';

const SRE_SYSTEM_PROMPT = `You are an SRE agent for ClickStack/HyperDX. A ClickStack alert has fired. Investigate the root cause using the clickstack MCP server (logs, traces, metrics, and alert history). Reconstruct and re-run the alert's source query over its time range, inspect related logs, traces, and metrics, follow any linked runbook, and check recent deploys. Produce a concise, evidence-linked root-cause summary and suggested next steps. Do not make changes to production systems.`;

export class AnthropicApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnthropicApiError';
    this.status = status;
  }
}

// Single choke point for outbound calls — only ever talks to api.anthropic.com.
const anthropicRequest = async (
  apiKey: string,
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<any> => {
  const res = await fetch(`${ANTHROPIC_API_BASE}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
      'content-type': 'application/json',
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AnthropicApiError(
      `Anthropic API ${method} ${path} failed (${res.status}): ${text}`,
      res.status,
    );
  }
  // DELETE may return an empty body.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
};

// Returns the decrypted Anthropic key for a team, or null if none is set.
export const getTeamAnthropicKey = async (
  teamId: ObjectId,
): Promise<string | null> => {
  const integration = await AnthropicIntegration.findOne({
    team: teamId,
  }).select('+encryptedApiKey');
  if (!integration) return null;
  return decrypt(integration.encryptedApiKey);
};

// Provisions a ClickStack SRE agent: environment + vault (with the ClickStack
// MCP credential) + agent, then persists the references. The MCP URL is written
// identically to the agent and the vault credential — credential injection
// matches on that URL, so any drift would break auth.
export const provisionClickStackAgent = async ({
  teamId,
  userId,
  userAccessKey,
  name,
  model,
}: {
  teamId: ObjectId;
  userId: ObjectId;
  userAccessKey: string;
  name: string;
  model: string;
}) => {
  const apiKey = await getTeamAnthropicKey(teamId);
  if (!apiKey) {
    throw new AnthropicApiError(
      'No Anthropic API key configured for this team',
      400,
    );
  }

  // Anthropic requires the MCP server URL to be public HTTPS (its cloud sandbox
  // reaches it directly). In real deployments FRONTEND_URL is already HTTPS; for
  // local testing point HDX_MANAGED_AGENTS_MCP_URL at a public tunnel (e.g.
  // ngrok) to your instance's /api/mcp.
  const mcpServerUrl =
    process.env.HDX_MANAGED_AGENTS_MCP_URL || `${config.FRONTEND_URL}/api/mcp`;
  if (!mcpServerUrl.startsWith('https://')) {
    throw new AnthropicApiError(
      `The ClickStack MCP URL must use HTTPS for Anthropic (got "${mcpServerUrl}"). Set HDX_MANAGED_AGENTS_MCP_URL to a public HTTPS URL (e.g. an ngrok tunnel to your local instance's /api/mcp) and try again.`,
      400,
    );
  }

  const environment = await anthropicRequest(
    apiKey,
    'POST',
    '/v1/environments',
    {
      name: `clickstack-sre-${name}`,
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    },
  );

  const vault = await anthropicRequest(apiKey, 'POST', '/v1/vaults', {
    display_name: `ClickStack: ${name}`,
  });

  await anthropicRequest(apiKey, 'POST', `/v1/vaults/${vault.id}/credentials`, {
    display_name: 'ClickStack Personal API Access Key',
    auth: {
      type: 'static_bearer',
      mcp_server_url: mcpServerUrl,
      token: userAccessKey,
    },
  });

  const agent = await anthropicRequest(apiKey, 'POST', '/v1/agents', {
    name,
    model,
    system: SRE_SYSTEM_PROMPT,
    mcp_servers: [{ type: 'url', name: 'clickstack', url: mcpServerUrl }],
    tools: [
      { type: 'agent_toolset_20260401' },
      { type: 'mcp_toolset', mcp_server_name: 'clickstack' },
    ],
  });

  return ManagedAgent.create({
    team: teamId,
    name,
    model,
    anthropicAgentId: agent.id,
    vaultId: vault.id,
    environmentId: environment.id,
    mcpServerUrl,
    createdBy: userId,
  });
};

// Best-effort deletion of the agent on Anthropic. Failures are logged but do
// not block local removal (the user can also delete it from the Claude console).
export const deleteAnthropicAgent = async (
  teamId: ObjectId,
  anthropicAgentId: string,
): Promise<void> => {
  const apiKey = await getTeamAnthropicKey(teamId);
  if (!apiKey) return;
  try {
    await anthropicRequest(apiKey, 'DELETE', `/v1/agents/${anthropicAgentId}`);
  } catch (e) {
    logger.warn(
      { error: serializeError(e), anthropicAgentId },
      'Failed to delete agent on Anthropic; removing local record anyway',
    );
  }
};
