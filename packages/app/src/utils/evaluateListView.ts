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
 * Non-tag rules (recency, has-active-alerts, created-by-me) need
 * per-item context that the listing must precompute and pass in.
 * The evaluator stays pure: it does not read the alert config off
 * tiles or compare the current user identity, the caller does that
 * once per item and feeds the boolean / id in.
 */
export type ListViewEvalContext = {
  currentUserId?: string;
  currentUserEmail?: string;
  itemHasActiveAlerts?: boolean;
};

export type ListViewEvalItem = {
  tags: string[];
  updatedAt?: Date | string;
  createdBy?: { _id?: string; email?: string } | null;
};

export function evaluateListView<T extends ListViewEvalItem>(
  view: {
    rules?: ListViewRule[] | null;
    combinator?: ListViewCombinator | null;
  },
  item: T,
  context?: ListViewEvalContext,
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
      case 'updated-within-days': {
        if (!item.updatedAt) return false;
        // Pure evaluator runs once per item at filter time. Using a
        // module-level NOW would stop the window from advancing as
        // the page sits open; the consumer is non-React here so the
        // re-render heuristic in `no-restricted-syntax` doesn't apply.
        // eslint-disable-next-line no-restricted-syntax
        const ageMs = Date.now() - new Date(item.updatedAt).valueOf();
        if (Number.isNaN(ageMs)) return false;
        return ageMs / 86_400_000 < rule.days;
      }
      case 'has-active-alerts':
        return Boolean(context?.itemHasActiveAlerts);
      case 'created-by-me': {
        const cb = item.createdBy;
        if (!cb) return false;
        if (context?.currentUserId && cb._id === context.currentUserId) {
          return true;
        }
        if (
          context?.currentUserEmail &&
          cb.email === context.currentUserEmail
        ) {
          return true;
        }
        return false;
      }
    }
  };

  return view.combinator === 'any' ? rules.some(pass) : rules.every(pass);
}
