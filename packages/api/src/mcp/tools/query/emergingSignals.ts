import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { parseTimeRange } from './helpers';
import { mineWindowPatterns, normalizeTemplate } from './runEventPatterns';
import { sourceIdSchema, whereLanguageSchema, whereSchema } from './schemas';

// ─── Classification ────────────────────────────────────────────────────────

/**
 * Decide whether a pattern's share swing between the baseline and current
 * windows makes it emerging, disappeared, or neither. Pure so the exact
 * threshold behavior is unit-testable.
 *
 * - emerging: absent from baseline and clears `newPatternShareFloor`, OR
 *   `curShare / baseShare >= ratio`.
 * - disappeared: absent from the current window, OR
 *   `baseShare / curShare >= ratio`.
 *
 * Comparisons are inclusive (`>=`) and cross-multiplied rather than divided:
 * `curShare >= ratio * baseShare` instead of `curShare / baseShare >= ratio`
 * (drops the old divide-by-`(x + EPS)` hack that always nudged the ratio the
 * wrong way and could suppress a genuine shift, and needs no divide-by-zero
 * guard).
 *
 * Shares are floating-point, so a shift that is mathematically exactly `ratio`×
 * can land a hair above the cross-product for some sample sizes (e.g. at a 10k
 * sample, `3 * (1/10000)` rounds just above `3/10000`) and be dropped. A tiny
 * RELATIVE tolerance biased toward qualifying admits the exact boundary while
 * still rejecting anything meaningfully below it (2.9× stays out).
 */
const RATIO_REL_TOLERANCE = 1e-9;

export function classifyShift(
  shares: { curShare: number; baseShare: number },
  ratio: number,
  newPatternShareFloor: number,
): 'emerging' | 'disappeared' | null {
  const { curShare, baseShare } = shares;
  if (baseShare === 0) {
    return curShare >= newPatternShareFloor ? 'emerging' : null;
  }
  const tol = 1 - RATIO_REL_TOLERANCE;
  if (curShare >= ratio * baseShare * tol) return 'emerging';
  if (curShare === 0 || baseShare >= ratio * curShare * tol) {
    return 'disappeared';
  }
  return null;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const emergingSignalsSchema = z.object({
  sourceId: sourceIdSchema,
  where: whereSchema,
  whereLanguage: whereLanguageSchema,
  bodyExpression: z
    .string()
    .optional()
    .describe(
      'Column expression to mine patterns from. Auto-detected from the source ' +
        'if omitted (Body for logs, SpanName for traces). ' +
        'Example: "Body", "SpanName", "SpanAttributes[\'http.url\']".',
    ),
  currentStartTime: z
    .string()
    .describe(
      'Start of the CURRENT / report window (ISO 8601). This is the window you ' +
        'want to characterize (e.g. the last hour).',
    ),
  currentEndTime: z
    .string()
    .describe(
      'End of the CURRENT / report window (ISO 8601). Required — pass the ' +
        'current timestamp for a window ending now.',
    ),
  baselineStartTime: z
    .string()
    .describe(
      'Start of the BASELINE window (ISO 8601) — an earlier "normal" period to ' +
        'compare against. Should NOT overlap the current window.',
    ),
  baselineEndTime: z
    .string()
    .describe(
      'End of the BASELINE window (ISO 8601). Typically equals currentStartTime ' +
        '(the baseline ends where the current window begins).',
    ),
  sampleSize: z
    .number()
    .min(1)
    .max(25_000)
    .optional()
    .default(10_000)
    .describe('Rows sampled per window for pattern mining. Default 10000.'),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Max emerging + disappeared patterns to return each. Default 20.',
    ),
  minShareRatio: z
    .number()
    .min(1)
    .optional()
    .default(3)
    .describe(
      'How many times more frequent (by share of window) a pattern must be in ' +
        'the current window vs baseline to count as EMERGING (and vice-versa ' +
        'for DISAPPEARED). Default 3× — a pattern must have tripled its share to ' +
        'qualify as a shift, not just noise.',
    ),
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerEmergingSignals({
  context,
  registerTool,
}: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_emerging_signals',
    {
      title: 'Emerging & Disappeared Signals',
      description:
        'Detect what is NEW or GONE between an earlier baseline window and a ' +
        'current window — log/event patterns that emerged, ramped up, or ' +
        'stopped. This answers "what changed / what is novel?" — NOT "what ' +
        'attribute value differs?".\n\n' +
        'USE THIS for status checks, health reports, post-deploy diffs, and any ' +
        '"call out anything new or worth a closer look" question. It mines ' +
        'event patterns (Drain) in BOTH windows and set-differences them:\n' +
        '  - emerging:    patterns whose share of the window is >= minShareRatio× ' +
        'higher now than in baseline (includes brand-new templates absent from ' +
        'baseline)\n' +
        '  - disappeared: patterns that were common in baseline but >= ' +
        'minShareRatio× rarer (or absent) now\n\n' +
        'WHY NOT clickstack_event_deltas: event_deltas compares ATTRIBUTE VALUE ' +
        'DISTRIBUTIONS between two row groups (e.g. "region shifted toward ' +
        'eu-west"). It CANNOT surface a brand-new log template or a new endpoint ' +
        'that simply did not exist before — a novel signal has no baseline ' +
        'distribution to shift. Use emerging_signals for novelty/emergence ' +
        '(set membership over time); use event_deltas for "what is different ' +
        'about these rows" (distribution shift within a shared population).\n\n' +
        'Requires sourceId — call clickstack_list_sources / ' +
        'clickstack_describe_source first. Provide two non-overlapping windows: ' +
        'the current window to characterize and an earlier baseline. Typically ' +
        'baselineEndTime == currentStartTime.\n\n' +
        'CALIBRATION: routine variance is not novelty. A pattern that merely ' +
        'wobbled in volume is NOT emerging; only report shifts past ' +
        'minShareRatio. An empty emerging list is a valid, informative answer ' +
        '("nothing novel") — do not manufacture findings.',
      inputSchema: emergingSignalsSchema,
    },
    async input => {
      const cur = parseTimeRange(input.currentStartTime, input.currentEndTime);
      if ('error' in cur) return mcpUserError(`current window: ${cur.error}`);
      const base = parseTimeRange(
        input.baselineStartTime,
        input.baselineEndTime,
      );
      if ('error' in base)
        return mcpUserError(`baseline window: ${base.error}`);

      // Reject overlapping windows outright. An overlapping baseline shares
      // rows with the current window, so the set-difference is contaminated and
      // "emerging"/"disappeared" results are actively misleading rather than
      // just noisy. (Inverted / zero-length windows are already caught by
      // parseTimeRange above.)
      if (base.endDate > cur.startDate && base.startDate < cur.endDate) {
        return mcpUserError(
          'baseline and current windows overlap — the baseline must end at or ' +
            'before the current window starts (typically baselineEndTime == ' +
            'currentStartTime). Overlapping windows share rows and produce a ' +
            'misleading novelty diff. Adjust the windows so they do not overlap.',
        );
      }

      const opts = {
        where: input.where,
        whereLanguage: input.whereLanguage,
        bodyExpression: input.bodyExpression,
        sampleSize: input.sampleSize,
        trendBuckets: 0,
      };

      const [curRes, baseRes] = await Promise.all([
        mineWindowPatterns(
          teamId.toString(),
          input.sourceId,
          cur.startDate,
          cur.endDate,
          opts,
        ),
        mineWindowPatterns(
          teamId.toString(),
          input.sourceId,
          base.startDate,
          base.endDate,
          opts,
        ),
      ]);
      if ('error' in curRes) return curRes.error;
      if ('error' in baseRes) return baseRes.error;

      // Build share-of-window maps keyed by normalized template.
      type Agg = {
        pattern: string;
        curShare: number;
        baseShare: number;
        curCount: number;
        baseCount: number;
        sample: string;
      };
      const byKey = new Map<string, Agg>();

      const ingest = (res: typeof curRes, which: 'cur' | 'base') => {
        const sampled = res.sampledCount || 1;
        for (const p of res.patterns) {
          const key = normalizeTemplate(p.pattern);
          let a = byKey.get(key);
          if (!a) {
            a = {
              pattern: p.pattern,
              curShare: 0,
              baseShare: 0,
              curCount: 0,
              baseCount: 0,
              sample: p.samples?.[0]
                ? String(p.samples[0].__hdx_pattern_body ?? '')
                : p.pattern,
            };
            byKey.set(key, a);
          }
          const share = p.sampleCount / sampled;
          // Accumulate rather than overwrite: if two Drain clusters in ONE
          // window normalize to the same key, both contribute their share/count
          // instead of the second silently clobbering the first. Each window is
          // ingested exactly once and all fields init to 0, so additive merge is
          // correct for both colliding and non-colliding keys.
          if (which === 'cur') {
            a.curShare += share;
            a.curCount += p.estimatedCount;
          } else {
            a.baseShare += share;
            a.baseCount += p.estimatedCount;
          }
        }
      };
      ingest(curRes, 'cur');
      ingest(baseRes, 'base');

      const ratio = input.minShareRatio;
      // Minimum share for a BRAND-NEW pattern (absent from baseline) to count
      // as emerging. A single sampled row that Drain happened to cluster on its
      // own is not a signal — require roughly two sampled rows' worth of share
      // so one-off log lines don't get reported as novel "new" patterns. Uses
      // the current window's sample size; falls back to 0 (no floor) when the
      // window sampled nothing so we never divide by zero.
      const newPatternShareFloor =
        curRes.sampledCount > 0 ? 2 / curRes.sampledCount : 0;
      const emerging: Agg[] = [];
      const disappeared: Agg[] = [];
      for (const a of byKey.values()) {
        const verdict = classifyShift(a, ratio, newPatternShareFloor);
        if (verdict === 'emerging') emerging.push(a);
        else if (verdict === 'disappeared') disappeared.push(a);
      }
      // Rank by absolute share swing.
      emerging.sort(
        (x, y) => y.curShare - y.baseShare - (x.curShare - x.baseShare),
      );
      disappeared.sort(
        (x, y) => y.baseShare - y.curShare - (x.baseShare - x.curShare),
      );

      const fmt = (a: Agg) => ({
        pattern: a.pattern,
        currentShare: Math.round(a.curShare * 10000) / 10000,
        baselineShare: Math.round(a.baseShare * 10000) / 10000,
        currentEstimatedCount: a.curCount,
        baselineEstimatedCount: a.baseCount,
        status:
          a.baseShare === 0 ? 'new' : a.curShare === 0 ? 'gone' : 'shifted',
        sample: a.sample.slice(0, 300),
      });

      const output = {
        summary: {
          currentWindow: {
            start: cur.startDate.toISOString(),
            end: cur.endDate.toISOString(),
            sampled: curRes.sampledCount,
            total: curRes.totalCount,
          },
          baselineWindow: {
            start: base.startDate.toISOString(),
            end: base.endDate.toISOString(),
            sampled: baseRes.sampledCount,
            total: baseRes.totalCount,
          },
          minShareRatio: ratio,
          emergingCount: emerging.length,
          disappearedCount: disappeared.length,
          bodyColumn: curRes.bodyColumn,
          ...(curRes.sampledCount === 0 || baseRes.sampledCount === 0
            ? {
                warning:
                  'One or both windows sampled 0 rows — an empty emerging/' +
                  'disappeared result here means NO DATA, not "nothing novel". ' +
                  'Verify the time windows and where filter via clickstack_search.',
              }
            : {}),
        },
        emerging: emerging.slice(0, input.topN).map(fmt),
        disappeared: disappeared.slice(0, input.topN).map(fmt),
        usage:
          'emerging = patterns newly present or >= minShareRatio× more frequent ' +
          '(by share of window) now vs baseline; status "new" means absent from ' +
          'baseline entirely. disappeared = the reverse. Shares are fractions of ' +
          "each window's sampled rows, so they are comparable across windows of " +
          'different volume. An empty emerging list means nothing novel crossed ' +
          'the threshold — a valid finding.',
      };

      const { data, isTrimmed } = trimToolResponse(output);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              isTrimmed
                ? {
                    ...data,
                    note: 'Trimmed for context size — lower topN or narrow windows.',
                  }
                : data,
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
