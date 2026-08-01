import type { ToolCallRecord } from '@/harness/types';

import type {
  ProgrammaticCheck,
  ProgrammaticHit,
  ProgrammaticResult,
} from './types';

/** Cap per-line length so a single huge tool arg can't bloat the transcript. */
const MAX_ARGS_CHARS = 2000;

/**
 * Serialize a run's tool-call transcript into a stable, regex-friendly
 * string for transcript-aware programmatic checks. One call per line, in the
 * order they were made, formatted as `<toolName> <compact-JSON-args>`.
 *
 * Only tool **names + input args** are included — outputs are intentionally
 * omitted (large, noisy, and nondeterministic). Args are compact JSON so a
 * rubric can assert on both the tool used (name) and how it was used (args),
 * e.g. "used a metric tool" or "described the JVM memory metric".
 */
export function serializeTranscript(toolCalls: ToolCallRecord[]): string {
  return toolCalls
    .map(call => {
      let args = '';
      if (call.input !== undefined && call.input !== null) {
        try {
          args =
            typeof call.input === 'string'
              ? call.input
              : JSON.stringify(call.input);
        } catch {
          // Circular / non-serializable input — fall back to a marker so the
          // tool name is still gradeable.
          args = '[unserializable]';
        }
      }
      if (args.length > MAX_ARGS_CHARS) {
        args = args.slice(0, MAX_ARGS_CHARS) + '…';
      }
      return args ? `${call.name} ${args}` : call.name;
    })
    .join('\n');
}

/**
 * Run transcript-aware checks against a run's tool-call transcript. Thin
 * wrapper over {@link runProgrammaticChecks} that serializes the transcript
 * first. Result shape is identical to answer checks so reports can treat both
 * uniformly.
 */
export function runTranscriptChecks(
  toolCalls: ToolCallRecord[],
  checks: ProgrammaticCheck[],
): ProgrammaticResult {
  return runProgrammaticChecks(serializeTranscript(toolCalls), checks);
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
