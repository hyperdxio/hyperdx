import type { ActionRow, ActionType, IncidentRow } from './types';

export type Playbook = {
  incidentId: string;
  rootCause: string;
  rootCauseNode: string;
  resolution: string;
  steps: Array<{
    seq: number;
    actionType: ActionType;
    tool: string;
    args: unknown;
    reason: string;
    summary: string;
    outcome: 'led_to_fix' | 'useful';
  }>;
  ruledOut: Array<{ seq: number; summary: string }>;
};

export function parseArgs(text: string): unknown {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function buildPlaybook(
  incident: IncidentRow,
  actions: ActionRow[],
): Playbook {
  const sorted = [...actions].sort((a, b) => a.seq - b.seq);
  const steps: Playbook['steps'] = [];
  const ruledOut: Playbook['ruledOut'] = [];
  for (const a of sorted) {
    if (a.outcome === 'led_to_fix' || a.outcome === 'useful') {
      steps.push({
        seq: a.seq,
        actionType: a.action_type,
        tool: a.tool,
        args: parseArgs(a.args),
        reason: a.reason,
        summary: a.summary,
        outcome: a.outcome,
      });
    } else if (a.outcome === 'dead_end') {
      ruledOut.push({ seq: a.seq, summary: a.summary });
    }
  }
  return {
    incidentId: incident.incident_id,
    rootCause: incident.root_cause,
    rootCauseNode: incident.root_cause_node,
    resolution: incident.resolution,
    steps,
    ruledOut,
  };
}
