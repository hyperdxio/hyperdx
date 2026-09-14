// Loads downstream extension registrations (no-op in OSS) — see
// packages/api/src/extensions/index.ts for the contract.
import '@/extensions';

import {
  AGENT_TOOLSET,
  AUTO_ALLOWED_MCP_TOOLS,
} from '@hyperdx/common-utils/dist/managedAgents';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import AgentRun, { AgentRunDocument } from '@/models/agentRun';
import ManagedAgent, { ManagedAgentDocument } from '@/models/managedAgent';
import {
  runAnthropicKeyExtensions,
  runProvisionExtensions,
  runSessionStartExtensions,
} from '@/services/agentRunExtensions';
import { isDuplicateKeyError } from '@/utils/errors';
import {
  getCounter,
  setBusinessContext,
  withOperationMetrics,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'managed-agents-2026-04-01';

// Every outbound Anthropic call is bounded so a hung/slow endpoint cannot stall
// the check-alerts sweep (agent sessions are started inline on that cron).
const ANTHROPIC_REQUEST_TIMEOUT_MS = 20_000;

const SRE_SYSTEM_PROMPT = `You are an SRE agent for ClickStack/HyperDX. A ClickStack alert has fired. Investigate the root cause using the clickstack MCP server (logs, traces, metrics, and alert history). Reconstruct and re-run the alert's source query over its time range, inspect related logs, traces, and metrics, follow any linked runbook, and check recent deploys. Produce a concise, evidence-linked root-cause summary and suggested next steps. Do not make changes to production systems.`;

// ClickStack MCP tools an alert-triggered agent may run without approval.
// An orphan is a vault or environment nothing points at any more — the vault
// case leaves a live ClickStack credential on Anthropic, so it needs to be
// alertable, not just greppable in the logs.
const orphanedResourceCounter = getCounter(
  'hyperdx.managed_agents.orphaned_resources',
  {
    description:
      'Count of Anthropic resources left behind by a failed managed-agent rollback or teardown.',
  },
);

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
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<any> => {
  let res: Response;
  try {
    res = await fetch(`${ANTHROPIC_API_BASE}${path}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_BETA,
        'content-type': 'application/json',
      },
      // Bounded so a hung request can't block the alert sweep forever.
      signal: AbortSignal.timeout(ANTHROPIC_REQUEST_TIMEOUT_MS),
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    // Network failure or the timeout above (AbortSignal → TimeoutError).
    // Surface as an AnthropicApiError (504) so callers handle transport
    // failures the same way as HTTP errors.
    throw new AnthropicApiError(
      `Anthropic API ${method} ${path} failed: ${e instanceof Error ? e.message : String(e)}`,
      504,
    );
  }
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

// Resolves an Anthropic API key from the environment for managed-agent calls.
// Managed agents are Anthropic-specific, so AI_API_KEY is trusted only when the
// AI provider is EXPLICITLY Anthropic; a legacy setup (no AI_PROVIDER) uses only
// the unambiguous ANTHROPIC_API_KEY. This guarantees a non-Anthropic AI_API_KEY
// (e.g. an OpenAI key, or an ambiguous key in a misconfigured legacy setup) is
// never sent to api.anthropic.com.
const resolveEnvAnthropicKey = (): string | null => {
  const key =
    (config.AI_PROVIDER === config.AIProvider.Anthropic
      ? config.AI_API_KEY
      : '') || config.ANTHROPIC_API_KEY;
  return key || null;
};

// Resolves the Anthropic API key for a team, or null if none is configured.
// OSS resolves it from the environment; a downstream distribution can register
// a `resolveAnthropicKey` extension to supply a per-team key, which takes
// precedence (see services/agentRunExtensions.ts).
export const getTeamAnthropicKey = async (
  teamId: ObjectId,
): Promise<string | null> => {
  const fromExtension = await runAnthropicKeyExtensions({
    teamId: teamId.toString(),
  });
  return fromExtension ?? resolveEnvAnthropicKey();
};

// Confirms the agent will actually be able to reach the ClickStack MCP server
// before we provision anything on Anthropic. The agent authenticates with the
// same bearer token, so we exercise that exact path (reachability + auth) by
// sending an MCP `initialize`. This catches the common setup mistakes up front —
// a dead/wrong tunnel (no response or 404), the URL pointed at the wrong port or
// path, or an access key the MCP server rejects (401) — instead of creating an
// agent that silently can't talk to ClickStack.
export const verifyMcpReachable = async (
  mcpServerUrl: string,
  userAccessKey: string,
): Promise<void> => {
  const unreachable = (detail: string) =>
    new AnthropicApiError(
      `Could not reach the ClickStack MCP server at ${mcpServerUrl}: ${detail}. ` +
        `Check that the URL is a live HTTPS tunnel to your instance — the API port uses the path /mcp, the app port uses /api/mcp.`,
      400,
    );

  let res: Response;
  try {
    res = await fetch(mcpServerUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAccessKey}`,
        'content-type': 'application/json',
        // The streamable-HTTP transport requires both content types in Accept.
        accept: 'application/json, text/event-stream',
      },
      // Bounded like the Anthropic calls, so a tunnel that accepts the
      // connection but never responds can't hang the provisioning request.
      signal: AbortSignal.timeout(ANTHROPIC_REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'hyperdx-provision-check', version: '1.0.0' },
        },
      }),
    });
  } catch (e) {
    throw unreachable(e instanceof Error ? e.message : String(e));
  }

  if (res.status === 401) {
    throw new AnthropicApiError(
      `The ClickStack MCP server at ${mcpServerUrl} rejected the access key (401), so the agent would not be able to authenticate.`,
      400,
    );
  }
  // Auth passed (no 401) and the MCP endpoint answered. A non-OK status here
  // means the URL is not the MCP endpoint (e.g. 404 from a wrong path or an
  // offline tunnel).
  if (!res.ok) {
    throw unreachable(`it returned HTTP ${res.status}`);
  }
};

// Anthropic requires the MCP server URL to be public HTTPS (its cloud sandbox
// reaches it directly). In real deployments FRONTEND_URL is already HTTPS; for
// local testing point HDX_MANAGED_AGENTS_MCP_URL at a public tunnel (e.g.
// ngrok) to your instance's /api/mcp.
const resolveMcpServerUrl = (): string => {
  const mcpServerUrl =
    config.getManagedAgentsMcpUrl() || `${config.FRONTEND_URL}/api/mcp`;
  if (!mcpServerUrl.startsWith('https://')) {
    throw new AnthropicApiError(
      `The ClickStack MCP URL must use HTTPS for Anthropic (got "${mcpServerUrl}"). Set HDX_MANAGED_AGENTS_MCP_URL to a public HTTPS URL (e.g. an ngrok tunnel to your local instance's /api/mcp) and try again.`,
      400,
    );
  }
  return mcpServerUrl;
};

// The environment and vault a session needs, whoever wrote the agent itself.
// Rolls back its own resources if a later step fails, so a half-made pair is
// never left behind. The MCP URL is written identically here and on the agent —
// credential injection matches on that URL, so any drift would break auth.
const provisionAgentSupport = async ({
  apiKey,
  name,
  mcpServerUrl,
  userAccessKey,
}: {
  apiKey: string;
  name: string;
  mcpServerUrl: string;
  userAccessKey: string;
}): Promise<{ environmentId: string; vaultId: string }> => {
  let environmentId: string | undefined;
  let vaultId: string | undefined;
  try {
    const environment = await anthropicRequest(
      apiKey,
      'POST',
      '/v1/environments',
      {
        name: `clickstack-sre-${name}`,
        config: { type: 'cloud', networking: { type: 'unrestricted' } },
      },
    );
    environmentId = environment.id;

    const vault = await anthropicRequest(apiKey, 'POST', '/v1/vaults', {
      display_name: `ClickStack: ${name}`,
    });
    vaultId = vault.id;

    await anthropicRequest(
      apiKey,
      'POST',
      `/v1/vaults/${vault.id}/credentials`,
      {
        display_name: 'ClickStack Personal API Access Key',
        auth: {
          type: 'static_bearer',
          mcp_server_url: mcpServerUrl,
          token: userAccessKey,
        },
      },
    );

    return { environmentId: environment.id, vaultId: vault.id };
  } catch (e) {
    reportOrphans(
      await deleteAnthropicResources(apiKey, { environmentId, vaultId }),
    );
    throw e;
  }
};

// Provisions a ClickStack SRE agent: environment + vault (with the ClickStack
// MCP credential) + agent, then persists the references.
const provisionClickStackAgentImpl = async ({
  teamId,
  userId,
  userAccessKey,
  name,
  model,
  instructions,
}: {
  teamId: ObjectId;
  userId: ObjectId;
  userAccessKey: string;
  name: string;
  model: string;
  /** Team-authored brief, appended to the standing prompt. */
  instructions?: string;
}) => {
  const apiKey = await getTeamAnthropicKey(teamId);
  if (!apiKey) {
    throw new AnthropicApiError(
      'No Anthropic API key configured for this team',
      400,
    );
  }

  const mcpServerUrl = resolveMcpServerUrl();

  // Fail fast if the agent won't be able to talk to ClickStack, before creating
  // any Anthropic resources.
  await verifyMcpReachable(mcpServerUrl, userAccessKey);

  const { environmentId, vaultId } = await provisionAgentSupport({
    apiKey,
    name,
    mcpServerUrl,
    userAccessKey,
  });

  // If agent creation or the local persist fails, best-effort delete what was
  // created so a partial failure doesn't leave orphaned resources the user
  // can't see or remove.
  let agentId: string | undefined;
  try {
    // Extension seam: downstream may replace the standing system prompt
    // wholesale (fail-open — the OSS default is used if nothing overrides).
    // The prompt is baked into the Anthropic agent object, so a swap applies
    // to newly provisioned agents only.
    // Appended, not substituted: the standing prompt carries the operational
    // contract (investigate through MCP, change nothing in production), which
    // a team brief should refine rather than be able to drop.
    const brief = instructions?.trim();
    const basePrompt = brief
      ? `${SRE_SYSTEM_PROMPT}\n\nTeam instructions for this agent:\n${brief}`
      : SRE_SYSTEM_PROMPT;
    const { systemPrompt } = await runProvisionExtensions({
      teamId: teamId.toString(),
      name,
      model,
      mcpServerUrl,
      defaultSystemPrompt: basePrompt,
    });

    const agent = await anthropicRequest(apiKey, 'POST', '/v1/agents', {
      name,
      model,
      system: systemPrompt,
      mcp_servers: [{ type: 'url', name: 'clickstack', url: mcpServerUrl }],
      tools: [
        AGENT_TOOLSET,
        {
          type: 'mcp_toolset',
          mcp_server_name: 'clickstack',
          // An unattended session can never answer an approval prompt, so
          // anything left at `always_ask` simply never runs: only the
          // allowlisted read tools fire from an alert, and the MCP server's
          // save_*/delete_*/patch_* tools stall instead. `always_ask` is this
          // toolset's default, but that is not a general rule — the built-in
          // toolset defaults the other way, which is why AGENT_TOOLSET above
          // spells its policy out.
          default_config: { permission_policy: { type: 'always_ask' } },
          configs: AUTO_ALLOWED_MCP_TOOLS.map(toolName => ({
            name: toolName,
            permission_policy: { type: 'always_allow' },
          })),
        },
      ],
    });
    agentId = agent.id;

    return await ManagedAgent.create({
      team: teamId,
      name,
      model,
      ...(brief ? { instructions: brief } : {}),
      anthropicAgentId: agent.id,
      vaultId,
      environmentId,
      mcpServerUrl,
      createdBy: userId,
    });
  } catch (e) {
    reportOrphans(
      await deleteAnthropicResources(apiKey, {
        agentId,
        environmentId,
        vaultId,
      }),
    );
    throw e;
  }
};

// Links an agent that already exists on Anthropic (written by hand, or by
// another tool) so alerts can target it. Only the agent ID comes from the user:
// the environment and vault are provisioned here, exactly as for a HyperDX-made
// agent, because the vault credential has to match this instance's MCP URL and
// carry a working ClickStack key. Reusing whatever vault the user happens to
// have would make the most common failure a silent one — an agent that runs but
// can't read any data.
const importAnthropicAgentImpl = async ({
  teamId,
  userId,
  userAccessKey,
  name,
  anthropicAgentId,
}: {
  teamId: ObjectId;
  userId: ObjectId;
  userAccessKey: string;
  /** Optional label; defaults to the agent's own name on Anthropic. */
  name?: string;
  anthropicAgentId: string;
}): Promise<{ agent: ManagedAgentDocument; verified: boolean }> => {
  const apiKey = await getTeamAnthropicKey(teamId);
  if (!apiKey) {
    throw new AnthropicApiError(
      'No Anthropic API key is configured, so HyperDX could not start sessions for this agent. Set one and import again.',
      400,
    );
  }

  const existing = await ManagedAgent.findOne({
    team: teamId,
    anthropicAgentId,
  });
  if (existing) {
    throw new AnthropicApiError(
      `That agent is already in the list as "${existing.name}".`,
      409,
    );
  }

  const mcpServerUrl = resolveMcpServerUrl();
  await verifyMcpReachable(mcpServerUrl, userAccessKey);

  // Confirms the ID is real before it becomes an alert target, since the
  // alternative is finding out at 3am when the alert fires. Only a definite
  // "no such agent" blocks the import — any other failure (network, or an
  // Anthropic API that does not serve this read) leaves the agent unverified
  // rather than unusable.
  // The name and model belong to the agent object on Anthropic, so they are
  // read from it rather than retyped here — a copy would drift the moment the
  // agent is edited there, and the model is only ever displayed: sessions run
  // whatever the agent object says.
  let verified = false;
  let remoteName: string | undefined;
  let model: string | undefined;
  try {
    const info = await anthropicRequest(
      apiKey,
      'GET',
      `/v1/agents/${encodeURIComponent(anthropicAgentId)}`,
    );
    verified = true;
    remoteName = typeof info?.name === 'string' ? info.name : undefined;
    model = typeof info?.model === 'string' ? info.model : undefined;
  } catch (e) {
    if (e instanceof AnthropicApiError && e.status === 404) {
      throw new AnthropicApiError(
        `Anthropic has no agent with ID "${anthropicAgentId}". Copy it from the create response, or from the agent's page in the Claude console.`,
        400,
      );
    }
    logger.warn(
      { error: serializeError(e), anthropicAgentId },
      'Could not verify an imported agent with Anthropic; importing unverified',
    );
  }

  // Falls back to the ID so the row is never nameless when the read failed.
  const label = name?.trim() || remoteName || anthropicAgentId;

  const { environmentId, vaultId } = await provisionAgentSupport({
    apiKey,
    name: label,
    mcpServerUrl,
    userAccessKey,
  });

  // Same rollback contract as provisioning: the record is the only pointer to
  // the vault holding the user's ClickStack key, so a failed write must not
  // leave that vault behind. The agent object is the user's and is never torn
  // down here.
  let agent: ManagedAgentDocument;
  try {
    agent = await ManagedAgent.create({
      team: teamId,
      name: label,
      ...(model ? { model } : {}),
      anthropicAgentId,
      vaultId,
      environmentId,
      mcpServerUrl,
      imported: true,
      createdBy: userId,
    });
  } catch (e) {
    reportOrphans(
      await deleteAnthropicResources(apiKey, { environmentId, vaultId }),
    );
    throw e;
  }
  return { agent, verified };
};

// A failed rollback leaves resources nothing points at — the caller is about to
// throw the original error, so log the leftovers loudly rather than discard the
// list the way the delete path reports it to the user.
const reportOrphans = (orphaned: string[]) => {
  if (orphaned.length > 0) {
    orphanedResourceCounter.add(orphaned.length);
    logger.error(
      { orphaned },
      'Anthropic resources were left behind by a failed rollback',
    );
  }
};

// Best-effort teardown of an agent's supporting Anthropic resources (vault
// first, then environment). Used both to roll back a failed provisioning run
// and to fully tear an agent down on delete — the vault holds the team's
// ClickStack bearer credential, so it must not be left behind. Each deletion is
// independent and swallows its own error so it never masks the caller's flow.
const deleteAnthropicResources = async (
  apiKey: string,
  {
    agentId,
    environmentId,
    vaultId,
  }: { agentId?: string; environmentId?: string; vaultId?: string },
): Promise<string[]> => {
  // Labels of resources still on Anthropic after this ran, so a caller that
  // must not report success (a user-initiated delete) can say what is left.
  const orphaned: string[] = [];
  const cleanup = async (label: string, path: string) => {
    try {
      await anthropicRequest(apiKey, 'DELETE', path);
    } catch (e) {
      // Already gone is the desired end state, which also makes a retry after
      // a partial failure safe.
      if (e instanceof AnthropicApiError && e.status === 404) {
        return;
      }
      logger.warn(
        { error: serializeError(e), resource: label },
        'Failed to delete Anthropic resource; it may be left orphaned',
      );
      orphaned.push(label);
    }
  };
  if (agentId) await cleanup('agent', `/v1/agents/${agentId}`);
  if (vaultId)
    await cleanup(
      'vault (holds the ClickStack access key)',
      `/v1/vaults/${vaultId}`,
    );
  if (environmentId)
    await cleanup('environment', `/v1/environments/${environmentId}`);
  return orphaned;
};

// Best-effort delete of a session we created but couldn't fully record, so it
// doesn't keep running (and consuming quota) untracked.
const deleteSessionBestEffort = async (
  apiKey: string,
  sessionId: string,
): Promise<void> => {
  try {
    await anthropicRequest(apiKey, 'DELETE', `/v1/sessions/${sessionId}`);
  } catch (e) {
    orphanedResourceCounter.add(1);
    logger.warn(
      { error: serializeError(e), sessionId },
      'Failed to delete an untracked agent session; it may keep running',
    );
  }
};

// Best-effort deletion of an agent on Anthropic: the agent object plus its
// supporting vault and environment. Deleting the vault matters for credential
// hygiene — it holds the team's ClickStack bearer token, which would otherwise
// sit on Anthropic indefinitely after the agent is removed. Failures are logged
// but do not block local removal (the user can also delete from the Claude
// console).
// `anthropicAgentId` is null for an imported agent: the agent object is the
// user's, so only the environment and vault HyperDX created are torn down.
const deleteAnthropicAgentImpl = async (
  teamId: ObjectId,
  anthropicAgentId: string | null,
  resources: { vaultId?: string; environmentId?: string } = {},
): Promise<void> => {
  const apiKey = await getTeamAnthropicKey(teamId);
  // Throwing rather than returning quietly: the caller drops the local record
  // on success, and a record dropped without the remote teardown orphans the
  // vault holding the team's ClickStack credential with nothing left pointing
  // at it.
  if (!apiKey) {
    throw new AnthropicApiError(
      'No Anthropic API key is configured, so the agent could not be deleted on Anthropic. Set the key and retry, or delete it from the Claude console first.',
      400,
    );
  }

  const orphaned = await deleteAnthropicResources(apiKey, {
    ...(anthropicAgentId ? { agentId: anthropicAgentId } : {}),
    ...resources,
  });
  if (orphaned.length > 0) {
    orphanedResourceCounter.add(orphaned.length);
    throw new AnthropicApiError(
      `Anthropic still holds: ${orphaned.join(', ')}. The agent was kept so you can retry; deleting again resumes where this left off.`,
      502,
    );
  }
};

// Alert notifications are level-triggered (they fire every evaluation window
// while the threshold is breached), but we don't want a fresh agent session
// every minute. Dedupe per alert-event per window: re-fires inside the window
// reuse the run; a firing in a later window (a persisting or recurring
// incident) gets a fresh investigation. ponytail: fixed 1h cooldown; tie to the
// alert interval only if a fixed window proves too coarse.
// Placeholder while a run reserves its dedupe key, before the Anthropic
// session exists. Never surfaced: nothing outside this module reads the field.
const PENDING_SESSION_ID = 'pending';

const AGENT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

// Kicks off a managed-agent investigation for a firing alert: starts an
// Anthropic session against the referenced agent, injects the alert prompt,
// and records an AgentRun for dedupe. The investigation runs (and its result
// lives) in the Anthropic session — the agent's own configuration decides
// where findings go. `deduped` is true when the firing was already handled
// within the dedupe window and the existing run is returned instead.
const startAgentSessionImpl = async ({
  agentId,
  teamId,
  alertId,
  eventId,
  title,
  prompt,
}: {
  agentId: string;
  teamId: ObjectId;
  alertId?: string;
  eventId: string;
  title: string;
  prompt: string;
}): Promise<{ run: AgentRunDocument | null; deduped: boolean }> => {
  setBusinessContext({ teamId: teamId.toString() });

  // Dedupe per alert per agent per cooldown window (see
  // AGENT_DEDUPE_WINDOW_MS). Deliberately NOT per event: eventId hashes the
  // group, so a grouped alert with N breaching groups would otherwise start N
  // Anthropic sessions every window — unbounded spend on high-cardinality
  // group-bys. One investigation per alert per window covers the incident (the
  // payload names the triggering group); eventId is only the fallback for a
  // caller with no alertId. The findOne is the cheap common-case check; the
  // unique index on the reservation below is the real race guard.
  const dedupeWindow = Math.floor(Date.now() / AGENT_DEDUPE_WINDOW_MS);
  // `||`, not `??`: the caller passes '' for an alert without an id, and an
  // empty discriminator would collapse every such alert into one dedupe bucket.
  const dedupeKey = `${alertId || eventId}:${agentId}:${dedupeWindow}`;
  const existing = await AgentRun.findOne({ team: teamId, dedupeKey });
  if (existing) return { run: existing, deduped: true };

  // Team-scoped lookup: an alert can only reference its own team's agents.
  const agent = await ManagedAgent.findOne({ _id: agentId, team: teamId });
  if (!agent) {
    throw new Error(
      `Managed agent not found. The agent may have been deleted — update the alert's notification channel.`,
    );
  }

  const apiKey = await getTeamAnthropicKey(teamId);
  if (!apiKey) {
    throw new AnthropicApiError(
      'No Anthropic API key configured for this team',
      400,
    );
  }

  // Claim the key before spending, so a concurrent firing loses here rather
  // than after paying for a session it discards. Session id filled in below.
  let run: AgentRunDocument;
  try {
    run = await AgentRun.create({
      team: teamId,
      managedAgent: agent._id,
      anthropicSessionId: PENDING_SESSION_ID,
      alertId,
      dedupeKey,
      title,
    });
  } catch (e) {
    // Lost the race — the winner owns the investigation.
    if (isDuplicateKeyError(e)) {
      return {
        run: await AgentRun.findOne({ team: teamId, dedupeKey }),
        deduped: true,
      };
    }
    throw e;
  }

  let session: { id: string } | undefined;
  try {
    session = await anthropicRequest(apiKey, 'POST', '/v1/sessions', {
      agent: agent.anthropicAgentId,
      environment_id: agent.environmentId,
      vault_ids: [agent.vaultId],
      title,
    });

    // Extension seam: downstream may replace the kickoff payload wholesale,
    // append instructions, and stash run metadata (fail-open — a broken
    // extension contributes nothing and the investigation proceeds).
    const ext = await runSessionStartExtensions({
      teamId: teamId.toString(),
      agent,
      anthropicSessionId: session!.id,
      title,
      prompt,
    });

    await anthropicRequest(
      apiKey,
      'POST',
      `/v1/sessions/${session!.id}/events`,
      {
        events: [
          {
            type: 'user.message',
            content: [{ type: 'text', text: ext.prompt }],
          },
        ],
      },
    );

    run.anthropicSessionId = session!.id;
    if (ext.runMetadata) run.metadata = ext.runMetadata;
    await run.save();
    return { run, deduped: false };
  } catch (e) {
    // Clean up in both directions: the session would otherwise keep running
    // untracked, and the reservation would dedupe away the next evaluation's
    // retry of an investigation that never actually started.
    if (session) await deleteSessionBestEffort(apiKey, session.id);
    // Releasing the reservation matters more than the session cleanup: a row
    // left behind dedupes this alert away for the rest of the window, so the
    // next firing silently never investigates. Count it like any other
    // leftover rather than swallowing it.
    await AgentRun.deleteOne({ _id: run._id }).catch(cleanupError => {
      orphanedResourceCounter.add(1);
      logger.error(
        { error: serializeError(cleanupError), dedupeKey },
        'Failed to release an agent-run reservation; this alert will not investigate again until the dedupe window rolls',
      );
    });
    throw e;
  }
};

// Wrapped rather than instrumented inline: each of these fans out across
// several Anthropic (and MCP) endpoints, and observability.md names external
// dependency calls as the withOperationMetrics case. The wrapper supplies the
// success/error outcome and the duration histogram.
export const provisionClickStackAgent = (
  ...args: Parameters<typeof provisionClickStackAgentImpl>
) =>
  withOperationMetrics('managed_agent.provision', () =>
    provisionClickStackAgentImpl(...args),
  );

export const importAnthropicAgent = (
  ...args: Parameters<typeof importAnthropicAgentImpl>
) =>
  withOperationMetrics('managed_agent.import', () =>
    importAnthropicAgentImpl(...args),
  );

export const deleteAnthropicAgent = (
  ...args: Parameters<typeof deleteAnthropicAgentImpl>
) =>
  withOperationMetrics('managed_agent.delete', () =>
    deleteAnthropicAgentImpl(...args),
  );

export const startAgentSession = (
  ...args: Parameters<typeof startAgentSessionImpl>
) =>
  withOperationMetrics('managed_agent.session_start', () =>
    startAgentSessionImpl(...args),
  );
