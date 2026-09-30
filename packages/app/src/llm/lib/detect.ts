import SqlString from 'sqlstring';

import { hasKeyWithPrefix } from './attributeUtils';
import { LLMSpanEvent, SpanAttributeMap } from './types';

/**
 * Attribute keys that positively identify a span as LLM-related, across the
 * supported instrumentation dialects. Kept small and high-precision: these
 * also drive the SQL predicate used by search/dashboards.
 */
const LLM_MARKER_ATTRIBUTE_KEYS = [
  // OTel GenAI semantic conventions (also emitted by OpenLLMetry + Vercel AI)
  'gen_ai.operation.name',
  'gen_ai.system',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  // Tool-execution spans that carry no model markers (e.g. Claude Code's
  // claude_code.tool spans)
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  // OpenInference (Arize)
  'llm.model_name',
  'openinference.span.kind',
  // Vercel AI SDK (< 4.0 emitted ai.* without gen_ai.* markers)
  'ai.operationId',
  'ai.model.id',
] as const;

/** Attribute key prefixes that identify LLM spans (client-side only). */
const LLM_MARKER_PREFIXES = [
  'gen_ai.',
  'llm.token_count.',
  'llm.input_messages.',
  'llm.output_messages.',
  'llm.invocation_parameters',
  'ai.prompt',
  'ai.response.',
  'ai.usage.',
];

/**
 * OpenInference tags every span with `openinference.span.kind`; only these
 * kinds are LLM-related enough to light up the LLM UI.
 */
const OPENINFERENCE_LLM_KINDS = new Set([
  'LLM',
  'AGENT',
  'TOOL',
  'CHAIN',
  'RETRIEVER',
  'EMBEDDING',
  'GUARDRAIL',
  'EVALUATOR',
]);

/**
 * Client-side detection: does this span carry LLM instrumentation from any
 * supported dialect? Intentionally broader than the SQL predicate.
 */
export function isLLMSpan(
  attributes: SpanAttributeMap | undefined | null,
  events?: LLMSpanEvent[],
): boolean {
  if (attributes && Object.keys(attributes).length > 0) {
    const kind = attributes['openinference.span.kind'];
    if (typeof kind === 'string' && OPENINFERENCE_LLM_KINDS.has(kind)) {
      return true;
    }
    if (
      LLM_MARKER_ATTRIBUTE_KEYS.some(
        key => key !== 'openinference.span.kind' && attributes[key] != null,
      )
    ) {
      return true;
    }
    if (
      LLM_MARKER_PREFIXES.some(prefix => hasKeyWithPrefix(attributes, prefix))
    ) {
      return true;
    }
  }
  return (events ?? []).some(event => event.name?.startsWith('gen_ai.'));
}

/**
 * SQL testing whether an attribute key is present on a row.
 *
 * For map columns this is `mapContains`, not `col['key'] != ''`, for two
 * reasons. It is one of the few shapes a `mapKeys(col)` skip index can serve
 * (`MergeTreeIndexConditionText::isSupportedFunction`) — `!= ''` normalizes to
 * `notEmpty()`, which no index supports, so it scans every granule. And a map
 * subscript is a subcolumn reference, which on ClickHouse 26.3+ costs one
 * per-part size lookup during PREWHERE planning; `mapContains` costs none.
 *
 * JSON columns keep the comparison: their paths are real subcolumns, and
 * `mapContains` does not apply.
 *
 * Trade-off: `fastifySQL` rewrites a `Col['key']` subscript onto a
 * materialized column when one exists, and it matches on the subscript AST
 * node, so it cannot see this form. On a table where an operator materialized
 * one of these keys, the subscript would have read that column instead. The
 * subscript is also not a subcolumn reference once rewritten, so such tables
 * never had the planning problem — this form trades that rewrite for skip-index
 * pruning, which is the better deal only where the columns do not exist (the
 * default).
 *
 * This tests presence only. Callers that pair a gate with a value expression
 * they group by need non-emptiness as well, or a key set to '' becomes a blank
 * row — see `anyKeyHasValue` in expressions.ts.
 *
 * queryParser's private `buildMapContains` emits the same call, but it takes a
 * rendered `col['key']` subscript and parses it back apart; the field and key
 * are already separate here. `attributeField` stays raw because it holds a
 * source's `eventAttributesExpression`, which may be a compound expression
 * rather than an identifier — the same reason `fieldAccess` interpolates it.
 */
function buildKeyExistsSql({
  attributeField,
  key,
  isJsonColumn,
}: {
  attributeField: string;
  key: string;
  isJsonColumn: boolean;
}): string {
  return isJsonColumn
    ? `toString(${attributeField}.\`${key}\`) != ''`
    : `mapContains(${attributeField}, ${SqlString.escape(key)})`;
}

/** SQL matching rows carrying any of the given attribute keys. */
export function buildAnyKeyExistsSql(args: {
  attributeField: string;
  keys: readonly string[];
  isJsonColumn: boolean;
}): string {
  const { attributeField, keys, isJsonColumn } = args;
  const conditions = keys.map(key =>
    buildKeyExistsSql({ attributeField, key, isJsonColumn }),
  );
  return `(${conditions.join(' OR ')})`;
}

/**
 * Build a SQL predicate matching LLM spans, for use in search filters and
 * dashboard chart configs. Handles both `Map(String, String)` attribute
 * columns and JSON-typed columns.
 *
 * Presence is the right test here: a span carrying `gen_ai.system` at all was
 * emitted by LLM instrumentation, whatever the value. Nothing groups by this
 * predicate, so an empty value cannot produce a blank row.
 */
export function buildLLMSpanSqlPredicate({
  attributeField,
  isJsonColumn,
}: {
  /** SQL expression for the span attributes column (e.g. `SpanAttributes`). */
  attributeField: string;
  isJsonColumn: boolean;
}): string {
  return buildAnyKeyExistsSql({
    attributeField,
    keys: LLM_MARKER_ATTRIBUTE_KEYS,
    isJsonColumn,
  });
}
