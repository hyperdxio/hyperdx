import {
  ListViewCombinator,
  ListViewRule,
} from '@hyperdx/common-utils/dist/types';

/**
 * Pure client-side evaluator for ListView rules.
 *
 * A view with zero rules matches everything (the rule list is a
 * narrower filter on top of whatever the listing already shows).
 *
 * In v1 every rule is a tag rule. PR-3 widens the rule type to
 * include non-tag kinds (recency, has-active-alerts, created-by-me,
 * provisioned, has-tile-type); when that lands, the `pass()` switch
 * extends with the new kinds and consumers gain `T` constraints for
 * the new fields they reference.
 */
export function evaluateListView<T extends { tags: string[] }>(
  view: {
    rules?: ListViewRule[] | null;
    combinator?: ListViewCombinator | null;
  },
  item: T,
): boolean {
  // Defensive: a view persisted before the local-mode default kicked in
  // (or returned by a server that dropped a field) may have `rules`
  // null/undefined or contain non-object entries. Skip the entries that
  // don't fit any rule shape rather than crashing the caller.
  const rules = Array.isArray(view.rules)
    ? view.rules.filter(
        (r): r is ListViewRule =>
          r != null && typeof r === 'object' && 'kind' in r,
      )
    : [];
  if (rules.length === 0) return true;

  const pass = (rule: ListViewRule): boolean => {
    switch (rule.kind) {
      case 'tag-includes':
        return item.tags.includes(rule.tag);
      case 'tag-excludes':
        return !item.tags.includes(rule.tag);
      case 'untagged':
        return item.tags.length === 0;
    }
  };

  return view.combinator === 'any' ? rules.some(pass) : rules.every(pass);
}
