import type { ToolCallRecord } from '@/harness/types';

import type {
  AdoptionCheck,
  ProgrammaticCheck,
  ProgrammaticHit,
  ProgrammaticResult,
} from './types';

/**
 * Cap per-call args length so one enormous payload can't bloat matching.
 * Generous (20k) because adoption checks must still find a metric name deep
 * inside a long multi-CTE SQL query.
 */
const MAX_ARGS_CHARS = 20_000;

/**
 * Serialize a single tool call's **input args** into a stable, regex-friendly
 * string. Compact JSON (or the raw string for string inputs). Tool names and
 * outputs are intentionally excluded — adoption checks must only see how the
 * agent *asked*, never what the tools returned or what the tool was called.
 */
export function serializeToolCallArgs(call: ToolCallRecord): string {
  let args = '';
  if (call.input !== undefined && call.input !== null) {
    try {
      args =
        typeof call.input === 'string'
          ? call.input
          : JSON.stringify(call.input);
    } catch {
      // Circular / non-serializable input — nothing gradeable.
      args = '[unserializable]';
    }
  }
  if (args.length > MAX_ARGS_CHARS) {
    args = args.slice(0, MAX_ARGS_CHARS) + '…';
  }
  return args;
}

/**
 * Compile a metric name/key into a separator-tolerant, case-insensitive
 * regex: every regex metachar is escaped, then each `.` boundary accepts
 * either `.` or `_` (so `jvm.gc.pause` also matches `jvm_gc_pause`). Full
 * keys are required — prose like "gc pause" in a log-search filter does not
 * match.
 */
export function metricKeyToRegex(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\\\./g, '[._]'), 'i');
}

/**
 * Run metric-adoption checks against a run's tool calls. A check is
 * satisfied when some **single** tool call's input args contain any of the
 * check's metric keys (and match `alsoPattern`, when present). Detection is
 * args-only and tool-name-agnostic, so a raw SQL query naming the metric
 * counts the same as a dedicated metric tool — the grader never branches on
 * which MCP/arm produced the call.
 *
 * Result shape is identical to answer checks so reports can treat both
 * uniformly.
 */
export function runAdoptionChecks(
  toolCalls: ToolCallRecord[],
  checks: AdoptionCheck[],
): ProgrammaticResult {
  const argsTexts = toolCalls.map(serializeToolCallArgs);

  const hits: ProgrammaticHit[] = [];
  let totalWeight = 0;
  let hitWeight = 0;

  for (const check of checks) {
    totalWeight += check.weight;
    const metricRegexes = check.metrics.map(metricKeyToRegex);
    let also: RegExp | null = null;
    if (check.alsoPattern !== undefined) {
      try {
        also = new RegExp(check.alsoPattern, 'i');
      } catch (err) {
        throw new Error(
          `Invalid alsoPattern in adoption check '${check.id}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    const matched = argsTexts.some(
      args =>
        metricRegexes.some(rx => rx.test(args)) && (!also || also.test(args)),
    );
    if (matched) hitWeight += check.weight;
    hits.push({
      id: check.id,
      weight: check.weight,
      matched,
      satisfied: matched,
    });
  }

  const score = totalWeight === 0 ? 0 : hitWeight / totalWeight;
  return { hits, score };
}

export function runProgrammaticChecks(
  answer: string,
  checks: ProgrammaticCheck[],
): ProgrammaticResult {
  const hits: ProgrammaticHit[] = [];
  let totalWeight = 0;
  let hitWeight = 0;

  for (const check of checks) {
    totalWeight += check.weight;
    const flags = check.flags ?? 'i';
    let regex: RegExp;
    try {
      regex = new RegExp(check.pattern, flags);
    } catch (err) {
      throw new Error(
        `Invalid regex in programmatic check '${check.id}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const matched = regex.test(answer);
    const satisfied = check.negative ? !matched : matched;
    if (satisfied) hitWeight += check.weight;
    hits.push({
      id: check.id,
      weight: check.weight,
      matched,
      satisfied,
      negative: check.negative,
    });
  }

  const score = totalWeight === 0 ? 0 : hitWeight / totalWeight;
  return { hits, score };
}
