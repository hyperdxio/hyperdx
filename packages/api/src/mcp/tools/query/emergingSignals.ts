import {
  flattenBody,
  TemplateMiner,
  TemplateMinerConfig,
} from '@hyperdx/common-utils/dist/drain';
import { z } from 'zod';

import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { parseTimeRange } from './helpers';
import { fetchWindowSample, mineWindowSample } from './runEventPatterns';
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
  // Require a real directional change in addition to meeting the ratio. Without
  // the `curShare > baseShare` / `baseShare > curShare` guards, a caller-allowed
  // `minShareRatio: 1` would classify every stable (equal-share) pattern as
  // emerging, flooding the novelty report with steady-state templates.
  if (curShare > baseShare && curShare >= ratio * baseShare * tol) {
    return 'emerging';
  }
  if (
    curShare === 0 ||
    (baseShare > curShare && baseShare >= ratio * curShare * tol)
  ) {
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
      'End of the CURRENT / report window (ISO 8601). Pass the ' +
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
    .describe('Rows sampled from each window for pattern mining.'),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Maximum patterns returned in each list (emerging and disappeared).',
    ),
  minShareRatio: z
    .number()
    .min(1)
    .optional()
    .default(3)
    .describe(
      'How many times more frequent (by share of window) a pattern must be in ' +
        'the current window vs baseline to count as EMERGING (and vice-versa ' +
        'for DISAPPEARED). At 3, a pattern must have tripled its share to ' +
        'qualify as a shift rather than noise.',
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
      annotations: READ_ONLY_TOOL,
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
        'baseline, and new messages that merged into a baseline pattern: ' +
        'status "new_variant")\n' +
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

      // One Drain tree for both windows: the same line lands in the same
      // cluster in either window, so the windows are compared by cluster id.
      // Separate trees keep tokens that were constant in one window literal
      // and generalize them in the other, which splits the same pattern.
      const fetchOpts = {
        where: input.where,
        whereLanguage: input.whereLanguage,
        bodyExpression: input.bodyExpression,
        sampleSize: input.sampleSize,
      };
      // The earlier window is half-open, so a row at the shared boundary is
      // counted only once (the baseline is usually first, but may come after).
      const baselineFirst = base.endDate <= cur.startDate;
      const [curSample, baseSample] = await Promise.all([
        fetchWindowSample(
          teamId.toString(),
          input.sourceId,
          cur.startDate,
          cur.endDate,
          { ...fetchOpts, endExclusive: !baselineFirst },
        ),
        fetchWindowSample(
          teamId.toString(),
          input.sourceId,
          base.startDate,
          base.endDate,
          { ...fetchOpts, endExclusive: baselineFirst },
        ),
      ]);
      if ('error' in curSample) return curSample.error;
      if ('error' in baseSample) return baseSample.error;

      // Mine in a fixed order (baseline, then current): Drain depends on
      // insertion order, so this keeps the result independent of which query
      // finished first.
      const miner = new TemplateMiner(new TemplateMinerConfig());
      const baseRes = mineWindowSample(baseSample, { trendBuckets: 0, miner });
      if ('error' in baseRes) return baseRes.error;
      // Each baseline cluster as it was before the current window is added
      // (token copies, so later template changes don't reach them).
      const baseline = new Map<
        string,
        { tokens: string[]; rows: number; sample: string }
      >();
      for (const p of baseRes.patterns) {
        const cluster = miner.drain.getCluster(Number(p.id));
        if (cluster)
          baseline.set(p.id, {
            tokens: [...cluster.logTemplateTokens],
            rows: p.sampleCount,
            sample: String(p.samples?.[0]?.__hdx_pattern_body ?? p.pattern),
          });
      }
      const curRes = mineWindowSample(curSample, { trendBuckets: 0, miner });
      if ('error' in curRes) return curRes.error;

      // Build share-of-window maps keyed by cluster id.
      type Agg = {
        pattern: string;
        curShare: number;
        baseShare: number;
        curCount: number;
        baseCount: number;
        sample: string;
        // Set on a new message that Drain merged into a baseline pattern.
        variant?: { baselinePattern: string; share: number };
      };
      const byKey = new Map<string, Agg>();

      const ingest = (res: typeof curRes, which: 'cur' | 'base') => {
        const sampled = res.sampledCount || 1;
        for (const p of res.patterns) {
          const key = p.id;
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
          // Each window is ingested once and the fields start at 0.
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
      // A cluster's template can still generalize after a window first sees
      // it, so report each cluster's template from the finished tree.
      for (const [key, a] of byKey) {
        a.pattern =
          miner.drain.getCluster(Number(key))?.getTemplate() ?? a.pattern;
      }

      // One tree merges a new message into a similar baseline pattern (e.g.
      // "login failed: invalid password" absorbs "login failed: account
      // locked"). A current row is a new variant when Drain put it in a
      // baseline cluster whose template the current window changed, and its
      // masked tokens don't fit the cluster's baseline template (the same
      // compare Drain's match() uses). Baseline clusters with fewer than 3
      // sampled rows are skipped: too rare to know which tokens are constant.
      const changed = new Map<string, string[]>();
      for (const [key, b] of baseline) {
        const now = miner.drain.getCluster(Number(key))?.getTemplate();
        if (b.rows >= 3 && now !== undefined && now !== b.tokens.join(' '))
          changed.set(key, b.tokens);
      }
      const variants = new Map<string, { rows: number; sample: string }>();
      curSample.sampleRows.forEach((row, i) => {
        const key = String(curRes.rowClusterIds.at(i));
        const tmpl = changed.get(key);
        if (!tmpl) return;
        const raw = String(row.__hdx_pattern_body ?? '');
        const tokens = miner.tokenize(flattenBody(raw));
        if (
          tokens.length === tmpl.length &&
          miner.drain.getSeqDistance(tmpl, tokens, true)[0] === 1
        )
          return;
        const v = variants.get(key);
        if (v) v.rows++;
        else variants.set(key, { rows: 1, sample: raw });
      });

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
      const sampled = curRes.sampledCount || 1;
      for (const [key, a] of byKey) {
        const v = variants.get(key);
        // Below the floor (e.g. one sampled row) a variant is noise, like a
        // one-row new pattern: classify the cluster as a whole.
        if (!v || v.rows / sampled < newPatternShareFloor) {
          const verdict = classifyShift(a, ratio, newPatternShareFloor);
          if (verdict === 'emerging') emerging.push(a);
          else if (verdict === 'disappeared') disappeared.push(a);
          continue;
        }
        // The new message is its own emerging entry; the rest of the cluster
        // (the baseline message) is listed only if it disappeared, so one
        // cluster never takes two emerging slots.
        const b = baseline.get(key);
        const baselinePattern = (b?.tokens ?? []).join(' ');
        const variantCount = Math.round(v.rows * curRes.sampleMultiplier);
        emerging.push({
          pattern: a.pattern,
          curShare: v.rows / sampled,
          baseShare: 0,
          curCount: variantCount,
          baseCount: 0,
          sample: v.sample,
          variant: { baselinePattern, share: v.rows / sampled },
        });
        const rest = {
          pattern: baselinePattern,
          curShare:
            Math.max(Math.round(a.curShare * sampled) - v.rows, 0) / sampled,
          baseShare: a.baseShare,
          curCount: Math.max(a.curCount - variantCount, 0),
          baseCount: a.baseCount,
          sample: b?.sample ?? baselinePattern,
        };
        if (classifyShift(rest, ratio, newPatternShareFloor) === 'disappeared')
          disappeared.push(rest);
      }
      // Rank by absolute share swing (a variant entry has baseShare 0, so its
      // swing is its own share, the same unit as a brand-new pattern).
      const swing = (a: Agg) => a.curShare - a.baseShare;
      emerging.sort((x, y) => swing(y) - swing(x));
      disappeared.sort(
        (x, y) => y.baseShare - y.curShare - (x.baseShare - x.curShare),
      );

      const fmt = (a: Agg) => ({
        pattern: a.pattern,
        currentShare: Math.round(a.curShare * 10000) / 10000,
        baselineShare: Math.round(a.baseShare * 10000) / 10000,
        currentEstimatedCount: a.curCount,
        baselineEstimatedCount: a.baseCount,
        status: a.variant
          ? 'new_variant'
          : a.baseShare === 0
            ? 'new'
            : a.curShare === 0
              ? 'gone'
              : 'shifted',
        sample: a.sample.slice(0, 300),
        ...(a.variant
          ? {
              baselinePattern: a.variant.baselinePattern,
              variantShare: Math.round(a.variant.share * 10000) / 10000,
            }
          : {}),
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
          'baseline entirely; status "new_variant" means new messages that ' +
          'merged into a baseline pattern (baselinePattern is the old ' +
          'template, sample a new line, variantShare their share); if the ' +
          'old message dropped, it is listed in disappeared. ' +
          'disappeared = the reverse. Shares are fractions of ' +
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
