import { parser } from '@prometheus-io/lezer-promql';

type SyntaxNode = ReturnType<typeof parser.parse>['topNode'];

/**
 * Whether a matcher appended before `closingBrace` needs a leading comma: the
 * list has a matcher and no trailing comma. Commas aren't nodes in the tree, so
 * look for one after the last matcher, skipping comments that may contain one.
 */
function needsSeparator(
  expression: string,
  labelMatchers: SyntaxNode,
  closingBrace: number,
): boolean {
  const comments: SyntaxNode[] = [];
  let lastMatcher: SyntaxNode | undefined;
  for (let child = labelMatchers.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LineComment') comments.push(child);
    else lastMatcher = child;
  }
  if (!lastMatcher) return false;

  let position = lastMatcher.to;
  let gap = '';
  for (const comment of comments) {
    if (comment.from < position) continue;
    gap += expression.slice(position, comment.from);
    position = comment.to;
  }
  gap += expression.slice(position, closingBrace);
  return !gap.includes(',');
}

/**
 * Add label matchers to every vector selector in a PromQL expression.
 * `matchers` is a comma-separated matcher list without braces, e.g.
 * `job="api", env=~"a|b"`.
 *
 * Throws when the expression doesn't parse, since silently skipping the
 * injection would show unfiltered data as if it were filtered.
 */
export function injectPromqlLabelMatchers(
  expression: string,
  matchers: string,
): string {
  if (!matchers.trim()) return expression;

  const tree = parser.parse(expression);
  const insertions: { at: number; text: string }[] = [];
  let errorAt: number | undefined;

  tree.iterate({
    enter: node => {
      if (node.type.isError) {
        errorAt ??= node.from;
        return;
      }
      if (node.name !== 'VectorSelector') return;

      const labelMatchers = node.node.getChild('LabelMatchers');
      if (!labelMatchers) {
        insertions.push({ at: node.to, text: `{${matchers}}` });
        return;
      }

      // Insert before the closing brace so a leading quoted metric name
      // (`{"my.metric", job="x"}`) stays first.
      const closingBrace = labelMatchers.to - 1;
      const separator = needsSeparator(expression, labelMatchers, closingBrace)
        ? ', '
        : '';
      insertions.push({ at: closingBrace, text: `${separator}${matchers}` });
    },
  });

  if (errorAt != null) {
    // Lezer error nodes carry no message, only where parsing went wrong.
    console.warn(
      `PromQL parse error at offset ${errorAt}: ${JSON.stringify(expression.slice(errorAt, errorAt + 20))}`,
      expression,
    );
    throw new Error(
      'Ad hoc filters could not be applied: the PromQL expression failed to parse.',
    );
  }

  return insertions
    .sort((a, b) => b.at - a.at)
    .reduce(
      (result, { at, text }) => result.slice(0, at) + text + result.slice(at),
      expression,
    );
}
