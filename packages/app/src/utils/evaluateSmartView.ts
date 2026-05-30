import {
  SmartViewCombinator,
  SmartViewRule,
} from '@hyperdx/common-utils/dist/types';

/**
 * Pure client-side evaluator for SmartView rules.
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
export function evaluateSmartView<T extends { tags: string[] }>(
  view: { rules: SmartViewRule[]; combinator: SmartViewCombinator },
  item: T,
): boolean {
  if (view.rules.length === 0) return true;

  const pass = (rule: SmartViewRule): boolean => {
    switch (rule.kind) {
      case 'tag-includes':
        return item.tags.includes(rule.tag);
      case 'tag-excludes':
        return !item.tags.includes(rule.tag);
      case 'untagged':
        return item.tags.length === 0;
    }
  };

  return view.combinator === 'all'
    ? view.rules.every(pass)
    : view.rules.some(pass);
}
