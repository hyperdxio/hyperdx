// Loads downstream extension registrations (no-op in OSS) — see
// packages/api/src/extensions/index.ts for the contract.
import '@/extensions';

import { isValidSlackUrl } from '@hyperdx/common-utils/dist/validation';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import AgentRun, { AgentRunDocument } from '@/models/agentRun';
import ManagedAgent from '@/models/managedAgent';
import type { AgentDeliveryLink } from '@/services/agentRunExtensions';
import {
  runAnthropicKeyExtensions,
  runDeliveryExtensions,
  runProvisionExtensions,
  runSessionStartExtensions,
} from '@/services/agentRunExtensions';
import { setBusinessContext } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'managed-agents-2026-04-01';

// Every outbound Anthropic call is bounded so a hung/slow endpoint cannot stall
// the shared check-alerts sweep (the poll loop runs inline on that cron).
const ANTHROPIC_REQUEST_TIMEOUT_MS = 20_000;
// Same rationale for the one Slack delivery per run (bounded locally in the
// poll loop rather than in the shared slack util, which serves other alerts).
const SLACK_DELIVERY_TIMEOUT_MS = 15_000;

// Stops waiting on a promise after `ms` so one slow call can't block the shared
// sweep. The underlying request may keep running in the background; we only
// stop awaiting it. The timer is unref'd so it never holds the process open.
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ).unref();
    }),
  ]);

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
      // Bounded so a hung request can't block the shared alert sweep forever.
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
    throw unreachable((e as Error).message);
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

  // Fail fast if the agent won't be able to talk to ClickStack, before creating
  // any Anthropic resources.
  await verifyMcpReachable(mcpServerUrl, userAccessKey);

  // Provisioning creates several Anthropic resources in sequence. If a later
  // step (or the local persist) fails, best-effort delete the ones already
  // created so a partial failure doesn't leave orphaned environments/vaults the
  // user can't see or remove. IDs are captured as we go for the rollback.
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

    // Extension seam: downstream may replace the standing system prompt
    // wholesale (fail-open — the OSS default is used if nothing overrides).
    // The prompt is baked into the Anthropic agent object, so a swap applies
    // to newly provisioned agents only.
    const { systemPrompt } = await runProvisionExtensions({
      teamId: teamId.toString(),
      name,
      model,
      mcpServerUrl,
      defaultSystemPrompt: SRE_SYSTEM_PROMPT,
    });

    const agent = await anthropicRequest(apiKey, 'POST', '/v1/agents', {
      name,
      model,
      system: systemPrompt,
      mcp_servers: [{ type: 'url', name: 'clickstack', url: mcpServerUrl }],
      tools: [
        { type: 'agent_toolset_20260401' },
        {
          type: 'mcp_toolset',
          mcp_server_name: 'clickstack',
          // MCP toolsets default to `always_ask`, which pauses the session
          // waiting for human approval. This loop is unattended (fired from an
          // alert), so auto-allow the ClickStack tools — they are read-only and
          // the system prompt forbids changes. Without this the session idles
          // immediately on the first tool call.
          default_config: { permission_policy: { type: 'always_allow' } },
        },
      ],
    });

    return await ManagedAgent.create({
      team: teamId,
      name,
      model,
      anthropicAgentId: agent.id,
      vaultId: vault.id,
      environmentId: environment.id,
      mcpServerUrl,
      createdBy: userId,
    });
  } catch (e) {
    await rollbackProvision(apiKey, { environmentId, vaultId });
    throw e;
  }
};

// Best-effort teardown of the Anthropic resources a failed provisioning run
// created (vault first, then environment). Each deletion is independent and
// swallows its own error — rollback must never mask the original failure.
const rollbackProvision = async (
  apiKey: string,
  { environmentId, vaultId }: { environmentId?: string; vaultId?: string },
): Promise<void> => {
  const cleanup = async (label: string, path: string) => {
    try {
      await anthropicRequest(apiKey, 'DELETE', path);
    } catch (e) {
      logger.warn(
        { error: serializeError(e), resource: label },
        'Failed to roll back partially-provisioned Anthropic resource; it may be orphaned',
      );
    }
  };
  if (vaultId) await cleanup('vault', `/v1/vaults/${vaultId}`);
  if (environmentId)
    await cleanup('environment', `/v1/environments/${environmentId}`);
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
    // A 404 means the agent is already gone on Anthropic — that's the desired
    // end state, so treat delete as idempotent rather than an error.
    if (e instanceof AnthropicApiError && e.status === 404) {
      logger.info(
        { anthropicAgentId },
        'Agent already absent on Anthropic (404); removing local record',
      );
      return;
    }
    logger.warn(
      { error: serializeError(e), anthropicAgentId },
      'Failed to delete agent on Anthropic; removing local record anyway',
    );
  }
};

// The Anthropic session `status` value that means the agent has finished its
// turn and is waiting. Verified against live sessions: the status field is
// `idle` (distinct from the `session.status_idled` webhook *event* name, which
// is what tripped this up originally).
const SESSION_IDLE_STATUS = 'idle';

// Sessions that never idle are abandoned after this, so the poll set stays
// bounded. ponytail: fixed ceiling; make it configurable only if real runs
// legitimately exceed it.
const MAX_SESSION_AGE_MS = 30 * 60 * 1000;

// Alert notifications are level-triggered (they fire every evaluation window
// while the threshold is breached), but we don't want a fresh agent session
// every minute. Dedupe per alert per window: re-fires inside the window reuse
// the run; a firing in a later window (a persisting or recurring incident) gets
// a fresh investigation. ponytail: fixed 1h cooldown; tie to the alert interval
// only if a fixed window proves too coarse.
const AGENT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

// Oldest-first cap per sweep, so one poll can't fan out unbounded GETs.
const MAX_RUNS_PER_SWEEP = 100;

// Give up (and report the real reason) after this many failed delivery attempts,
// rather than re-posting every sweep until the age ceiling.
const MAX_DELIVERY_ATTEMPTS = 5;

// A run claimed for delivery but left in `delivering` longer than this (e.g. the
// process crashed mid-post) is reclaimed for retry.
const RECLAIM_DELIVERING_MS = 5 * 60 * 1000;

// Kicks off a managed-agent investigation for a firing alert: starts an
// Anthropic session against the team's provisioned agent, injects the alert
// prompt, and records an AgentRun for the poll loop to deliver later. Returns
// the run, or null when the team has no agent provisioned (a misconfiguration
// that must not break alert delivery) or the firing was already handled.
export const startAgentSession = async ({
  teamId,
  alertId,
  eventId,
  title,
  prompt,
  deliverToUrl,
}: {
  teamId: ObjectId;
  alertId?: string;
  eventId: string;
  title: string;
  prompt: string;
  deliverToUrl: string;
}): Promise<AgentRunDocument | null> => {
  setBusinessContext({ teamId: teamId.toString() });

  // Results post straight to Slack from the poll loop, so reject a non-Slack
  // (or non-HTTPS) target up front — the only SSRF/transport guard on the
  // persisted deliverToUrl before the loop POSTs the agent summary to it.
  if (!isValidSlackUrl(deliverToUrl) || !deliverToUrl.startsWith('https://')) {
    throw new AnthropicApiError(
      `Claude agent delivery URL must be an HTTPS Slack webhook URL (got "${deliverToUrl}")`,
      400,
    );
  }

  // Dedupe per alert per cooldown window (see AGENT_DEDUPE_WINDOW_MS): a re-fire
  // inside the window reuses the run; a later window re-investigates. The window
  // suffix keeps the unique index from blocking future firings forever. The
  // findOne avoids the redundant Anthropic calls in the common case; the unique
  // index (+ 11000 catch below) is the real race guard.
  const dedupeWindow = Math.floor(Date.now() / AGENT_DEDUPE_WINDOW_MS);
  const dedupeKey = `${alertId ?? 'no-alert'}:${eventId}:${dedupeWindow}`;
  const existing = await AgentRun.findOne({ dedupeKey });
  if (existing) return existing;

  const agent = await ManagedAgent.findOne({ team: teamId }).sort({
    createdAt: -1,
  });
  if (!agent) {
    logger.warn(
      { teamId: teamId.toString() },
      'Claude alert fired but no managed agent is provisioned for the team; skipping',
    );
    return null;
  }

  const apiKey = await getTeamAnthropicKey(teamId);
  if (!apiKey) {
    throw new AnthropicApiError(
      'No Anthropic API key configured for this team',
      400,
    );
  }

  const session = await anthropicRequest(apiKey, 'POST', '/v1/sessions', {
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
    anthropicSessionId: session.id,
    title,
    prompt,
  });

  await anthropicRequest(apiKey, 'POST', `/v1/sessions/${session.id}/events`, {
    events: [
      { type: 'user.message', content: [{ type: 'text', text: ext.prompt }] },
    ],
  });

  try {
    return await AgentRun.create({
      team: teamId,
      managedAgent: agent._id,
      anthropicSessionId: session.id,
      alertId,
      status: 'running',
      deliverToUrl,
      dedupeKey,
      title,
      ...(ext.runMetadata ? { metadata: ext.runMetadata } : {}),
    });
  } catch (e: any) {
    // Lost a race to a concurrent firing — the other run owns the delivery.
    // The session we just created is now untracked, so best-effort delete it
    // rather than leave it running and consuming quota. (The findOne above
    // avoids this in the common case; this only fires on a genuine race.)
    if (e?.code === 11000) {
      try {
        await anthropicRequest(apiKey, 'DELETE', `/v1/sessions/${session.id}`);
      } catch (delErr) {
        logger.warn(
          { error: serializeError(delErr), sessionId: session.id },
          'Failed to delete the losing race session; it may keep running',
        );
      }
      return AgentRun.findOne({ dedupeKey });
    }
    throw e;
  }
};

// Pulls the agent's final summary text out of a session's event list. The
// agent's last `agent.message` is the answer; its content is a block array that
// may lead with non-text blocks (thinking/tool-use) or split prose across
// several text blocks, so concatenate every text block rather than taking the
// first.
const fetchSessionSummary = async (
  apiKey: string,
  sessionId: string,
): Promise<string> => {
  const res = await anthropicRequest(
    apiKey,
    'GET',
    `/v1/sessions/${sessionId}/events`,
  );
  const events: any[] = res.events ?? res.data ?? [];
  const messages = events.filter(e => e.type === 'agent.message');
  const last = messages[messages.length - 1];
  if (!Array.isArray(last?.content)) return '';
  return last.content
    .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n')
    .trim();
};

// Slack `section` mrkdwn text is capped at 3000 chars; a section over the cap
// renders blank, so an RCA summary (often several KB) must be split across
// blocks. We leave headroom and bound the block count (Slack allows ~50/msg).
const SLACK_SECTION_LIMIT = 2900;
const MAX_SUMMARY_BLOCKS = 40;

// Splits text into <=SLACK_SECTION_LIMIT chunks, preferring line boundaries so
// markdown stays readable; a single over-long line is hard-split.
export const chunkForSlack = (text: string): string[] => {
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };
  for (const line of text.split('\n')) {
    if (line.length > SLACK_SECTION_LIMIT) {
      flush();
      for (let i = 0; i < line.length; i += SLACK_SECTION_LIMIT) {
        chunks.push(line.slice(i, i + SLACK_SECTION_LIMIT));
      }
      continue;
    }
    if (current && current.length + line.length + 1 > SLACK_SECTION_LIMIT) {
      flush();
    }
    current = current ? `${current}\n${line}` : line;
  }
  flush();
  return chunks;
};

// Builds the Slack message for a finished investigation: a title header, the
// summary split into Slack-safe section blocks, and a footer linking back to the
// live session. Exported for testing.
export const buildAgentSlackMessage = (
  title: string,
  summary: string,
  sessionId: string,
  footerLinks: AgentDeliveryLink[] = [],
) => {
  const allChunks = summary.trim()
    ? chunkForSlack(summary)
    : ['_The agent produced no summary text — open the session for details._'];
  const chunks = allChunks.slice(0, MAX_SUMMARY_BLOCKS);
  const truncated = allChunks.length > MAX_SUMMARY_BLOCKS;
  const footerParts = [
    ...(truncated ? ['_(summary truncated)_'] : []),
    ...footerLinks.map(link => `<${link.url}|${link.label}>`),
    `Continue in the live agent session: ${sessionId}`,
  ];
  return {
    text: title,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${title}*` } },
      ...chunks.map(text => ({
        type: 'section',
        text: { type: 'mrkdwn', text },
      })),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: footerParts.join(' · ') }],
      },
    ],
  };
};

const failRun = async (run: AgentRunDocument, error: string): Promise<void> => {
  run.status = 'failed';
  run.error = error;
  await run.save();
};

// Sweeps in-flight agent runs: any whose Anthropic session has idled is claimed
// (atomically, so concurrent sweeps can't both deliver) and its summary posted
// to Slack, then marked delivered; sessions that never idle are abandoned past
// MAX_SESSION_AGE_MS. Designed to run on the check-alerts cadence. One bad run
// is logged and skipped — it never aborts the sweep.
export const pollAndDeliverAgentSessions = async (): Promise<void> => {
  // Feature-gated: with managed agents off there are no runs to deliver, so
  // skip the sweep entirely rather than query every check-alerts cadence.
  if (!config.IS_MANAGED_AGENTS_ENABLED) return;

  // Reclaim runs whose delivery was interrupted (claimed `delivering` but the
  // process died before finishing), so they retry instead of stalling.
  await AgentRun.updateMany(
    {
      status: 'delivering',
      updatedAt: { $lt: new Date(Date.now() - RECLAIM_DELIVERING_MS) },
    },
    { status: 'running' },
  );

  const runs = await AgentRun.find({ status: 'running' })
    .sort({ createdAt: 1 })
    .limit(MAX_RUNS_PER_SWEEP);

  for (const run of runs) {
    setBusinessContext({ teamId: run.team.toString() });
    // Evaluated independently of the session GET so a perpetually-failing poll
    // still gets abandoned rather than stuck `running` forever.
    const tooOld = Date.now() - run.createdAt.getTime() > MAX_SESSION_AGE_MS;
    try {
      const apiKey = await getTeamAnthropicKey(run.team);
      if (!apiKey) {
        if (tooOld)
          await failRun(run, 'Anthropic API key removed before delivery');
        continue;
      }

      let session: any;
      try {
        session = await anthropicRequest(
          apiKey,
          'GET',
          `/v1/sessions/${run.anthropicSessionId}`,
        );
      } catch (e) {
        if (tooOld) {
          await failRun(
            run,
            `Session polling kept failing: ${(e as Error).message}`,
          );
        } else {
          logger.warn(
            { error: serializeError(e), agentRunId: run._id.toString() },
            'Session poll failed; will retry next sweep',
          );
        }
        continue;
      }

      if (session.status !== SESSION_IDLE_STATUS) {
        if (tooOld) {
          await failRun(
            run,
            `Session did not idle within ${MAX_SESSION_AGE_MS}ms (last status: ${session.status})`,
          );
        }
        continue;
      }

      // Idle: claim it atomically before doing any visible work. If another
      // sweep already claimed it, findOneAndUpdate returns null and we skip.
      const claimed = await AgentRun.findOneAndUpdate(
        { _id: run._id, status: 'running' },
        { $set: { status: 'delivering' }, $inc: { attempts: 1 } },
        { new: true },
      );
      if (!claimed) continue;

      const summary = await fetchSessionSummary(apiKey, run.anthropicSessionId);

      // Idle but the final message isn't readable yet — release for retry,
      // up to the attempt cap, rather than delivering an empty placeholder.
      if (!summary && claimed.attempts < MAX_DELIVERY_ATTEMPTS) {
        claimed.status = 'running';
        await claimed.save();
        continue;
      }

      // Extension seam: delivery decorations (fail-open — a broken extension
      // yields none). Runs on every attempt, so extensions must be idempotent.
      const ext = await runDeliveryExtensions({ run: claimed, summary });

      try {
        await withTimeout(
          slack.postMessageToWebhook(
            claimed.deliverToUrl,
            buildAgentSlackMessage(
              claimed.title,
              summary,
              claimed.anthropicSessionId,
              ext.footerLinks,
            ),
          ),
          SLACK_DELIVERY_TIMEOUT_MS,
          'Slack delivery',
        );
        claimed.status = 'delivered';
        claimed.deliveredAt = new Date();
        await claimed.save();
      } catch (e) {
        // Delivery failed (e.g. revoked Slack webhook). Retry until the cap,
        // then fail with the real reason instead of re-posting every sweep.
        if (claimed.attempts >= MAX_DELIVERY_ATTEMPTS) {
          claimed.status = 'failed';
          claimed.error = `Slack delivery failed after ${claimed.attempts} attempts: ${(e as Error).message}`;
        } else {
          claimed.status = 'running';
        }
        await claimed.save();
        logger.warn(
          { error: serializeError(e), agentRunId: claimed._id.toString() },
          'Failed to deliver agent summary to Slack',
        );
      }
    } catch (e) {
      logger.warn(
        { error: serializeError(e), agentRunId: run._id.toString() },
        'Failed to poll/deliver agent session; will retry next sweep',
      );
    }
  }
};
