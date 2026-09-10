import type { OnboardingTaskId } from '@hyperdx/common-utils/dist/types';
import { ONBOARDING_TASK_IDS } from '@hyperdx/common-utils/dist/types';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  isComplete: boolean;
  isLoading?: boolean;
  href?: string;
  onClick?: () => void;
}

// Presentation for each product-usage task. Typed as an exhaustive
// Record<OnboardingTaskId, ...>: adding a new id to ONBOARDING_TASK_IDS in
// common-utils makes this object a compile error until copy + a link are
// provided, which is the type-safety guarantee the feature is built around.
export const PRODUCT_TASKS: Record<
  OnboardingTaskId,
  { title: string; description: string; href: string }
> = {
  advancedQuery: {
    title: 'Explore your data',
    description: 'Run a search with a filter or query condition',
    href: '/search',
  },
  dashboard: {
    title: 'Build a dashboard',
    description: 'Add a chart tile to a dashboard',
    href: '/dashboards',
  },
  alert: {
    title: 'Set up an alert',
    description: 'Get notified when something looks off',
    href: '/alerts',
  },
  mcp: {
    title: 'Connect the MCP server',
    description: 'Query your data from an AI agent',
    // The MCP setup lives on the "API & Agents" tab of team settings.
    href: '/team',
  },
};

// Render order for the product-usage phase is the declaration order of
// ONBOARDING_TASK_IDS (the SSOT), so there's no separate order map to keep in
// sync — a new id renders in the position it's added to the tuple.
export const PRODUCT_TASK_ORDER: readonly OnboardingTaskId[] =
  ONBOARDING_TASK_IDS;

// The 'advancedQuery' ("Explore your data") task completes on a non-trivial
// user-run search: a non-empty where clause in either language (the search page
// defaults to Lucene, so requiring SQL would make this practically
// unreachable), or any applied filter. A blank default search does not count.
// Kept as a pure helper so the rule is testable without rendering the search
// page.
export function isNonTrivialSearch(
  where: string,
  filters: unknown[] | undefined,
): boolean {
  return where.trim() !== '' || (filters?.length ?? 0) > 0;
}
