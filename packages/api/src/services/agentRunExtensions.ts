import type { AgentRunDocument } from '@/models/agentRun';
import type { ManagedAgentDocument } from '@/models/managedAgent';
import { getCounter, withSpan } from '@/utils/instrumentation';
import logger from '@/utils/logger';

// Extension seams for the managed-agent alert flow (anthropicAgents.ts).
//
// Downstream distributions (e.g. hyperdx-ee) register extensions from
// packages/api/src/extensions/index.ts — never by editing the core flow —
// so upstream merges stay conflict-free. Hooks are fail-open: a throwing
// extension is recorded (span + counter + log) and contributes nothing;
// the core flow never fails because of an extension.
//
// With zero extensions registered (the OSS default) the runners return
// neutral values and the core flow behaves exactly as before the seams.

export interface AgentProvisionContext {
  teamId: string;
  name: string;
  model: string;
  mcpServerUrl: string;
  // The OSS default system prompt, so overriders can extend rather than
  // rewrite from scratch.
  defaultSystemPrompt: string;
}

/**
 * @public Part of the extension seam contract consumed by hyperdx-ee; it has
 * no in-repo importer by design (OSS ships no extensions), so it is marked
 * `@public` for knip. See the EE-extensibility notes in AGENTS.md.
 */
export interface AgentProvisionResult {
  // Replaces the agent's standing system prompt wholesale. Baked into the
  // Anthropic agent object at provisioning time — affects NEW provisions only.
  systemPrompt?: string;
}

export interface AgentSessionStartContext {
  teamId: string;
  agent: ManagedAgentDocument;
  anthropicSessionId: string;
  title: string;
  // The OSS-built kickoff payload (enriched alert JSON) — overriders can
  // JSON.parse it, tweak the embedded instruction, and re-stringify.
  prompt: string;
}

/**
 * @public Part of the extension seam contract consumed by hyperdx-ee; no
 * in-repo importer by design. See the EE-extensibility notes in AGENTS.md.
 */
export interface AgentSessionStartResult {
  // Replaces the kickoff payload wholesale (last registered override wins).
  promptOverride?: string;
  // Appended verbatim after the resolved kickoff payload.
  promptSuffix?: string;
  // Shallow-merged across extensions, then persisted as AgentRun.metadata so
  // the extension can read it back in onBeforeDelivery. A later extension's
  // duplicate key wins silently, so keep keys extension-specific (e.g.
  // `notebookId`).
  runMetadata?: Record<string, unknown>;
}

export interface AgentDeliveryLink {
  label: string;
  url: string;
}

export interface AgentDeliveryContext {
  run: AgentRunDocument;
  summary: string;
}

/**
 * @public Part of the extension seam contract consumed by hyperdx-ee; no
 * in-repo importer by design. See the EE-extensibility notes in AGENTS.md.
 */
export interface AgentDeliveryResult {
  // Rendered in the Slack footer before the live-session line.
  footerLinks?: AgentDeliveryLink[];
}

export interface AgentKeyResolutionContext {
  teamId: string;
}

/**
 * @public Part of the extension seam contract consumed by hyperdx-ee; no
 * in-repo importer by design. See the EE-extensibility notes in AGENTS.md.
 */
export interface AgentKeyResolutionResult {
  // The Anthropic API key to use for this team's managed-agent calls.
  apiKey?: string;
}

export interface AgentRunExtension {
  // Stable identifier, used as a telemetry attribute.
  name: string;
  // At agent provisioning time, before the Anthropic agent is created.
  onProvisionAgent?(
    ctx: AgentProvisionContext,
  ): Promise<AgentProvisionResult | void>;
  // After the Anthropic session exists, before the kickoff message is sent.
  onSessionStart?(
    ctx: AgentSessionStartContext,
  ): Promise<AgentSessionStartResult | void>;
  // After the summary is fetched, before the Slack post. Runs on EVERY
  // delivery attempt (Slack failures are retried) — implementations MUST be
  // idempotent.
  onBeforeDelivery?(
    ctx: AgentDeliveryContext,
  ): Promise<AgentDeliveryResult | void>;
  // Resolves the team's Anthropic API key. OSS resolves the key from env
  // (see getTeamAnthropicKey); a downstream distribution can register this to
  // provide a per-team key instead (last registered wins). Fail-open: a
  // throwing resolver contributes nothing and the caller falls back to the env
  // key — so a transient failure resolving a per-team key degrades to the
  // operator's global key rather than failing closed. Implement the resolver
  // robustly (return void to opt out, never throw for an expected "no key")
  // if per-team key isolation must be strict.
  resolveAnthropicKey?(
    ctx: AgentKeyResolutionContext,
  ): Promise<AgentKeyResolutionResult | void>;
}

const extensions: AgentRunExtension[] = [];

const extensionEventsCounter = getCounter(
  'hyperdx.agent_run.extension_events',
  {
    description: 'Managed-agent extension hook outcomes',
  },
);

export const registerAgentRunExtension = (ext: AgentRunExtension): void => {
  extensions.push(ext);
};

// Registration is module-level state; suites reset it between tests.
export const resetAgentRunExtensionsForTests = (): void => {
  extensions.length = 0;
};

// Runs one hook across every registered extension. Each invocation is its own
// wide event; a throwing extension contributes nothing rather than failing
// the core flow.
const runHook = async <TCtx, TResult>(
  hook:
    | 'on_provision_agent'
    | 'on_session_start'
    | 'on_before_delivery'
    | 'on_resolve_anthropic_key',
  pick: (
    ext: AgentRunExtension,
  ) => ((ctx: TCtx) => Promise<TResult | void>) | undefined,
  ctx: TCtx,
): Promise<TResult[]> => {
  const results: TResult[] = [];
  for (const ext of extensions) {
    const fn = pick(ext);
    if (!fn) continue;
    try {
      const result = await withSpan(`agent_extension.${hook}`, async span => {
        span.setAttribute('agent_extension.name', ext.name);
        return fn.call(ext, ctx);
      });
      extensionEventsCounter.add(1, { hook, outcome: 'ok' });
      if (result) results.push(result);
    } catch (e) {
      extensionEventsCounter.add(1, { hook, outcome: 'error' });
      logger.error(
        {
          extension: ext.name,
          hook,
          error: e instanceof Error ? e.message : e,
        },
        'Agent run extension hook failed; continuing without its contribution',
      );
    }
  }
  return results;
};

// Picks the winning override when several extensions return one: last
// registered wins, and the displacement is warned about so a surprising
// collision is diagnosable rather than silent.
const pickLastOverride = (
  hook: string,
  overrides: string[],
): string | undefined => {
  if (overrides.length > 1) {
    logger.warn(
      { hook, count: overrides.length },
      'Multiple extensions returned an override; using the last registered',
    );
  }
  return overrides.at(-1);
};

// Resolves the standing system prompt for a new agent: the last extension to
// return one wins; with none registered the OSS default is used unchanged.
export const runProvisionExtensions = async (
  ctx: AgentProvisionContext,
): Promise<{ systemPrompt: string }> => {
  const results = await runHook(
    'on_provision_agent',
    ext => ext.onProvisionAgent,
    ctx,
  );
  const override = pickLastOverride(
    'on_provision_agent',
    results
      .map(r => r.systemPrompt)
      .filter((p): p is string => typeof p === 'string' && p.length > 0),
  );
  return { systemPrompt: override ?? ctx.defaultSystemPrompt };
};

// Resolves the kickoff message: the last promptOverride (if any) replaces the
// OSS payload, then every extension's suffix is appended in registration
// order. With nothing registered the result is ctx.prompt unchanged.
export const runSessionStartExtensions = async (
  ctx: AgentSessionStartContext,
): Promise<{
  prompt: string;
  runMetadata?: Record<string, unknown>;
}> => {
  const results = await runHook(
    'on_session_start',
    ext => ext.onSessionStart,
    ctx,
  );
  const override = pickLastOverride(
    'on_session_start',
    results
      .map(r => r.promptOverride)
      .filter((p): p is string => typeof p === 'string' && p.length > 0),
  );
  const promptSuffix = results.map(r => r.promptSuffix ?? '').join('');
  const metadataEntries = results
    .map(r => r.runMetadata)
    .filter(
      (m): m is Record<string, unknown> => !!m && Object.keys(m).length > 0,
    );
  return {
    prompt: (override ?? ctx.prompt) + promptSuffix,
    runMetadata:
      metadataEntries.length > 0
        ? Object.assign({}, ...metadataEntries)
        : undefined,
  };
};

export const runDeliveryExtensions = async (
  ctx: AgentDeliveryContext,
): Promise<{ footerLinks: AgentDeliveryLink[] }> => {
  const results = await runHook(
    'on_before_delivery',
    ext => ext.onBeforeDelivery,
    ctx,
  );
  return { footerLinks: results.flatMap(r => r.footerLinks ?? []) };
};

// Resolves the team's Anthropic API key via extensions: the last extension to
// return a non-empty key wins. With none registered (the OSS default) this
// returns null and the caller falls back to the env-configured key.
export const runAnthropicKeyExtensions = async (
  ctx: AgentKeyResolutionContext,
): Promise<string | null> => {
  const results = await runHook(
    'on_resolve_anthropic_key',
    ext => ext.resolveAnthropicKey,
    ctx,
  );
  const keys = results
    .map(r => r.apiKey)
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
  return keys.at(-1) ?? null;
};
