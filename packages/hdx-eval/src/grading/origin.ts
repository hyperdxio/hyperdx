import { escapeRegex } from '@/grading/blind';
import type { ProgrammaticResult } from '@/grading/types';
import type { ToolCallRecord } from '@/harness/types';

// Recording calls restate what the agent already found, so they are not investigation steps.
const RECORDING_TOOL =
  /(^|__)clickstack_(open_incident|record_incident_action|resolve_incident)$/;

/**
 * 1-based index of the first tool call whose args name the origin service, or
 * null if none does or the origin is the alerting service (nothing to find).
 * `\b` treats '-' as a boundary, so use lookarounds to keep 'cart' out of 'cart-db'.
 */
export function stepsToOrigin(
  toolCalls: ToolCallRecord[],
  origin: string,
  alerting: string,
): number | null {
  if (origin === alerting) return null;
  const rx = new RegExp(`(?<![\\w-])${escapeRegex(origin)}(?![\\w-])`);
  const i = toolCalls
    .filter(c => !RECORDING_TOOL.test(c.name))
    .findIndex(c => rx.test(JSON.stringify(c.input) ?? ''));
  return i === -1 ? null : i + 1;
}

export function negativeMatches(programmatic: ProgrammaticResult): number {
  return programmatic.hits.filter(h => h.negative === true && h.matched).length;
}
