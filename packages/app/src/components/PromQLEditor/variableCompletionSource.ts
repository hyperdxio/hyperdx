import { Completion, CompletionSource } from '@codemirror/autocomplete';

// Characters that make up a substitution reference: word chars for the name
// (DASHBOARD_VARIABLE_NAME_PATTERN allows nothing outside `[a-zA-Z0-9_]`),
// and `$`, `{`, `}` and `:` for the sigil, the delimiters and the `:format`
// suffix.
//
// PromQL's own completion matches `[\w.:]+`, which cannot see a leading `$` —
// hence a separate source rather than widening that one.
const VARIABLE_CHAR = '[\\w{}:$]';
const VARIABLE_BEFORE = new RegExp(`${VARIABLE_CHAR}+`);
const VARIABLE_VALID_FOR = new RegExp(`^\\$${VARIABLE_CHAR}*$`);

// The rest of the reference ahead of the cursor. CodeMirror filters options
// against — and on accept replaces — the whole [from, to] span, so these must
// cover the remainder of the reference and nothing past it: in the braced
// form the rest of the name/format up to and including the first `}`, so
// accepting `${svc}` over a half-typed `${sv}` doesn't leave a stray `}`
// while `${env}_total` stops before `_total`; in the bare form just the rest
// of the name, since `:` and `{` after a bare name belong to the
// surrounding PromQL, not the reference.
const VARIABLE_AFTER_BRACED = /^[\w:]*\}?/;
const VARIABLE_AFTER_BARE = /^\w*/;

/**
 * Completes dashboard variable references, and only those: without a `$` under
 * the cursor this returns null and leaves the popup to the metric-name and
 * built-in PromQL sources.
 */
export const createVariableCompletionSource: (
  completions: Completion[],
) => CompletionSource = completions => context => {
  const prefix = context.matchBefore(VARIABLE_BEFORE);
  if (prefix == null) return null;

  const dollar = prefix.text.lastIndexOf('$');
  if (dollar < 0) return null;

  const after =
    prefix.text[dollar + 1] === '{'
      ? VARIABLE_AFTER_BRACED
      : VARIABLE_AFTER_BARE;
  const suffix = context.state.doc.sliceString(context.pos).match(after);

  return {
    from: prefix.from + dollar,
    to: context.pos + (suffix?.[0].length ?? 0),
    options: completions,
    validFor: VARIABLE_VALID_FOR,
  };
};
