import { readdirSync } from 'fs';
import { join } from 'path';

import { scenarioSlug } from '@/clickhouse/schema';
import type { RunRecord } from '@/harness/types';
import type {
  HyperdxApiClient,
  OpenIncidentInput,
  RecordActionInput,
  ResolveIncidentInput,
} from '@/hyperdx/api';
import { getRunFilesInBatch } from '@/runs/path';
import { readRun } from '@/runs/store';
import type { MemoryMode } from '@/scenarios/types';

import {
  mechanismLabels,
  misleadingIncidents,
  relatedIncidents,
} from './families';
import { GROUND_TRUTH } from './groundTruth';
import {
  alertingService,
  SMOKEHOUSE_PREFIX,
  type SmokehouseGroundTruth,
} from './shared';

type IncidentRecord = {
  open: OpenIncidentInput;
  actions: RecordActionInput[];
  resolve: ResolveIncidentInput;
};

export const EVAL_TITLE_PREFIX = (scenario: string) =>
  `[eval:${scenarioSlug(scenario)}]`;
const ownPrefix = (gt: SmokehouseGroundTruth) =>
  EVAL_TITLE_PREFIX(`${SMOKEHOUSE_PREFIX}${gt.scenario}`);

// Symptom keys must match /^[a-z_]+:.+$/ on the API.
const label = (l: string) => l.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');

function base(gt: SmokehouseGroundTruth, prefix: string) {
  const origin = gt.expected.originService;
  const node = `service:${origin}`;
  const open: OpenIncidentInput = {
    title: `${prefix} ${gt.scenario}`,
    alertingService: alertingService(gt),
    symptomKeys: [
      node,
      ...[...mechanismLabels(gt)].map(l => `mechanism:${label(l)}`),
    ],
  };
  return { origin, node, open };
}

export function syntheticRecord(
  gt: SmokehouseGroundTruth,
  prefix = ownPrefix(gt),
): IncidentRecord {
  const { origin, node, open } = base(gt, prefix);
  const factor = gt.expected.contributingFactors?.[0];
  const actions: RecordActionInput[] = [
    {
      actionType: 'query',
      tool: 'clickstack_event_deltas',
      args: { service: origin },
      summary: `Compared failing and healthy rows for ${origin}.`,
    },
    {
      actionType: 'note',
      summary: factor ?? `${origin} is where the problem starts.`,
    },
  ];
  return {
    open,
    actions,
    resolve: {
      rootCause: gt.expected.summary,
      rootCauseNode: node,
      resolution: gt.expected.summary,
      outcomes: [
        { seq: 1, outcome: 'led_to_fix' },
        { seq: 2, outcome: 'useful' },
      ],
    },
  };
}

const toolName = (name: string) => name.split('__').pop() ?? name;
const isKnowledgeTool = (name: string) =>
  /^clickstack_(.*incident.*|blast_radius|trace_root_cause)$/.test(
    toolName(name),
  );
const KEY = /^[a-z_]+:.+$/;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

function lastInput(
  run: RunRecord,
  tool: string,
): Record<string, unknown> | undefined {
  const calls = run.toolCalls.filter(
    c => toolName(c.name) === tool && !c.isError,
  );
  const input = calls.at(-1)?.input;
  return input && typeof input === 'object'
    ? (input as Record<string, unknown>)
    : undefined;
}

function ownResolve(run: RunRecord) {
  const r = lastInput(run, 'clickstack_resolve_incident');
  const rootCause = str(r?.rootCause);
  const rootCauseNode = str(r?.rootCauseNode);
  const resolution = str(r?.resolution);
  if (!r || !rootCause || !rootCauseNode || !resolution) return undefined;
  return { r, rootCause, rootCauseNode, resolution };
}

// Replays the agent's own open and resolve calls; ground truth only supplies the title and a fallback alerting service.
export function selfRecord(
  run: RunRecord,
  gt: SmokehouseGroundTruth,
  prefix = ownPrefix(gt),
): IncidentRecord & { droppedOutcomes: number } {
  const own = ownResolve(run);
  if (!own)
    throw new Error('Run has no usable clickstack_resolve_incident call');
  const o = lastInput(run, 'clickstack_open_incident');
  const symptomKeys = Array.isArray(o?.symptomKeys)
    ? o.symptomKeys.filter(
        (k): k is string => typeof k === 'string' && KEY.test(k),
      )
    : [];
  const title = str(o?.title) ?? gt.scenario;

  // The agent's outcome seq k is its k-th successful record call.
  const recorded = run.toolCalls.filter(
    c => toolName(c.name) === 'clickstack_record_incident_action' && !c.isError,
  );
  let actions: RecordActionInput[];
  const outcomes: NonNullable<ResolveIncidentInput['outcomes']> = [];
  let droppedOutcomes = 0;
  if (recorded.length > 0) {
    actions = recorded.map(c => {
      const { incidentId: _id, ...rest } = (c.input ?? {}) as Record<
        string,
        unknown
      >;
      return rest as RecordActionInput;
    });
    const given = Array.isArray(own.r.outcomes) ? own.r.outcomes : [];
    for (const g of given as { seq?: number; outcome?: string }[]) {
      if (g.outcome && g.seq && g.seq >= 1 && g.seq <= actions.length) {
        outcomes.push({ seq: g.seq, outcome: g.outcome as 'unknown' });
      } else {
        droppedOutcomes++;
      }
    }
  } else {
    actions = run.toolCalls
      .filter(c => !isKnowledgeTool(c.name))
      .map(c => ({
        actionType: c.isError ? 'note' : 'query',
        tool: toolName(c.name).slice(0, 100),
        args:
          c.input && typeof c.input === 'object'
            ? (c.input as Record<string, unknown>)
            : undefined,
        summary: (c.output ?? c.name).slice(0, 300) || c.name,
      }));
    outcomes.push(
      ...actions.map((_, i) => ({ seq: i + 1, outcome: 'unknown' as const })),
    );
  }

  return {
    open: {
      title: `${prefix} ${title}`.slice(0, 200),
      alertingService: str(o?.alertingService) ?? alertingService(gt),
      symptomKeys,
      summary: str(o?.summary)?.slice(0, 5000),
    },
    actions,
    droppedOutcomes,
    resolve: {
      rootCause: own.rootCause,
      rootCauseNode: own.rootCauseNode,
      resolution: own.resolution,
      affectedNodes: Array.isArray(own.r.affectedNodes)
        ? own.r.affectedNodes.filter((n): n is string => typeof n === 'string')
        : [],
      outcomes,
      summary: str(own.r.summary)?.slice(0, 5000),
    },
  };
}

// Only runs that had the incident tools and wrote a brief, without seeded memory from other conditions.
const qualifies = (r: RunRecord) =>
  (r.memoryMode === undefined ||
    r.memoryMode === 'none' ||
    r.memoryMode === 'self') &&
  !!ownResolve(r);

function newestRun(runsDir: string, scenario: string): RunRecord | undefined {
  let newest: RunRecord | undefined;
  let batches: string[] = [];
  try {
    batches = readdirSync(runsDir);
  } catch {
    return undefined;
  }
  for (const b of batches) {
    const files = getRunFilesInBatch(join(runsDir, b), {
      scenarioFilter: s => s === scenario,
    });
    for (const f of files) {
      let r: RunRecord;
      try {
        r = readRun(f);
      } catch {
        continue;
      }
      // startedAt is an ISO string, so string comparison orders by time.
      if (qualifies(r) && (!newest || r.startedAt > newest.startedAt))
        newest = r;
    }
  }
  return newest;
}

export async function clearMemory(
  api: HyperdxApiClient,
  scenario: string,
): Promise<number> {
  return api.deleteIncidents(EVAL_TITLE_PREFIX(scenario));
}

export async function seedMemory(
  api: HyperdxApiClient,
  scenario: string,
  mode: MemoryMode,
  runsDir: string,
): Promise<number> {
  const stale = await clearMemory(api, scenario);
  if (stale > 0) {
    console.warn(
      `WARNING: cleared ${stale} existing incident(s) for ${scenario}. Another run against this API may be live, or a previous run crashed.`,
    );
  }
  if (mode === 'none') return 0;
  const name = scenario.slice(SMOKEHOUSE_PREFIX.length);
  const prefix = EVAL_TITLE_PREFIX(scenario);
  const names =
    mode === 'misleading' ? misleadingIncidents(name) : relatedIncidents(name);

  let seeded = 0;
  for (const other of names) {
    const gt = GROUND_TRUTH[other];
    let rec: IncidentRecord;
    if (mode === 'self') {
      const run = newestRun(runsDir, `${SMOKEHOUSE_PREFIX}${other}`);
      if (!run) continue;
      const own = selfRecord(run, gt, prefix);
      if (own.droppedOutcomes > 0) {
        console.warn(
          `WARNING: dropped ${own.droppedOutcomes} outcome(s) from ${run.scenario} that point at no recorded action.`,
        );
      }
      rec = own;
    } else {
      rec = syntheticRecord(gt, prefix);
    }
    const { incident_id: id } = await api.openIncident(rec.open);
    for (const a of rec.actions) await api.recordAction(id, a);
    await api.resolveIncident(id, rec.resolve);
    if (mode !== 'self') await api.confirmIncident(id);
    seeded++;
  }
  return seeded;
}
