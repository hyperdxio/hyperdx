import type { LogRow, TraceRow } from '@/generators/types';
import { buildInvestigationSystemPrompt } from '@/harness/systemPrompt';
import { HyperdxApiClient } from '@/hyperdx/api';
import { pinScenario, unpinScenario } from '@/hyperdx/sources';
import type {
  GenerateContext,
  Scenario,
  ScenarioBatch,
} from '@/scenarios/types';

import { chatter } from './generator/chatter';
import { drain, emitTrace } from './generator/emit';
import { type Incident, INCIDENTS } from './generator/incidents';
import { rng } from './generator/rng';
import { walk } from './generator/walker';
import { steadyState } from './generator/world';
import { GROUND_TRUTH } from './groundTruth';
import { clearMemory, seedMemory } from './memory';
import { traceToRows } from './rows';
import {
  alertingService,
  SMOKEHOUSE_PREFIX,
  type SmokehouseGroundTruth,
} from './shared';

export { SMOKEHOUSE_PREFIX, type SmokehouseGroundTruth };

const RECORDING_INSTRUCTIONS = `

INCIDENT RECORDING: if the incident tools are available, keep a record of this investigation.
1. Call clickstack_open_incident first, with the alerting service and the symptom keys you anchor on.
2. Call clickstack_record_incident_action for each query you rely on and each hypothesis you rule out.
3. Before your final answer, call clickstack_resolve_incident with the root cause, its node key, and an outcome for each recorded step.`;

const BACKFILL_MS = 90 * 60_000;
const RATE_PER_SEC = 20;

// Not re-entrant: the emit buffer is module-level. Each tick drains synchronously, so only
// the reset at the start (leftovers from a stopped run) matters.
function* generate(
  incident: Incident,
  ctx: GenerateContext,
): Iterable<ScenarioBatch> {
  const batchSize = ctx.batchSize ?? 10_000;
  const stepMs = 1000 / (RATE_PER_SEC * (ctx.volumeFactor ?? 1));
  const onset = new Date(ctx.nowMs + incident.defaultOnsetMs);
  const base = steadyState();
  // Seed the generator's own rng from ctx.rng so the whole run follows ctx's seed.
  const r = rng(ctx.rng.intRange(0, 2 ** 32));
  drain();

  let traces: TraceRow[] = [];
  let logs: LogRow[] = [];
  for (let t = ctx.nowMs - BACKFILL_MS; t < ctx.nowMs; t += stepMs) {
    const at = new Date(t);
    const world = incident.apply(at, onset, structuredClone(base));
    incident.events?.(at, onset, stepMs);
    chatter(at, stepMs, world, r);
    emitTrace(walk(at, world, r));
    const surge = incident.surge?.(at, onset);
    if (surge) {
      for (let n = surge.perTick + r.next(); n >= 1; n--) {
        emitTrace(walk(at, world, r, surge.forced));
      }
    }
    const tick = drain();
    logs.push(...tick.logs);
    for (const planned of tick.traces) {
      const rows = traceToRows(planned, ctx.rng);
      traces.push(...rows.traces);
      logs.push(...rows.logs);
    }
    if (traces.length + logs.length >= batchSize) {
      yield { traces, logs };
      traces = [];
      logs = [];
    }
  }
  if (traces.length || logs.length) yield { traces, logs };
}

function smokehouseScenario(
  incident: Incident,
  gt: SmokehouseGroundTruth,
): Scenario {
  const alerting = alertingService(gt);
  const name = `${SMOKEHOUSE_PREFIX}${incident.name}`;
  return {
    name,
    agentPrompt: `An alert fired on ${alerting}: it is degraded. Find the root cause.`,
    description: `Smokehouse incident ${incident.name}`,
    generate: ctx => generate(incident, ctx),
    groundTruth: gt as unknown as Record<string, unknown>,
    buildSystemPrompt: ctx =>
      buildInvestigationSystemPrompt(
        name,
        ctx.anchorTimeIso,
        ctx.variant,
        ctx.maxTurns,
      ) + RECORDING_INSTRUCTIONS,
    // Every mode pins the trace source, so 'none' needs the knowledge flag too.
    prepare: async ctx => {
      const api = new HyperdxApiClient(ctx.apiUrl, ctx.accessKey);
      await pinScenario(api, name, ctx.connectionId, ctx.memoryMode === 'self');
      await seedMemory(api, name, ctx.memoryMode, ctx.runsDir);
    },
    cleanup: async ctx => {
      const api = new HyperdxApiClient(ctx.apiUrl, ctx.accessKey);
      try {
        await clearMemory(api, name);
      } finally {
        await unpinScenario(api, name);
      }
    },
  };
}

export const SMOKEHOUSE_SCENARIOS: Record<string, Scenario> =
  Object.fromEntries(
    Object.values(INCIDENTS).map(incident => {
      const s = smokehouseScenario(incident, GROUND_TRUTH[incident.name]);
      return [s.name, s];
    }),
  );

export function smokehouseGroundTruth(name: string): SmokehouseGroundTruth {
  const s = SMOKEHOUSE_SCENARIOS[name];
  if (!s) throw new Error(`Unknown smokehouse scenario: ${name}`);
  return s.groundTruth as unknown as SmokehouseGroundTruth;
}
