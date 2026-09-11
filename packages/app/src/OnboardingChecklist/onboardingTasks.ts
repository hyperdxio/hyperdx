import { isNonEmptyWhereExpr } from '@hyperdx/common-utils/dist/core/renderChartConfig';
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

// Exhaustive Record so a new ONBOARDING_TASK_IDS entry is a compile error here
// until given copy + a link.
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
    // /team alone lands on the Data tab (TeamPage falls back to tabs[0]).
    href: '/team?tab=api-agents#team-api-agents-mcp-server',
  },
};

// Declaration order of the SSOT tuple is the render order.
export const PRODUCT_TASK_ORDER: readonly OnboardingTaskId[] =
  ONBOARDING_TASK_IDS;

// A blank default search must not count; a non-empty where (either language) or
// any applied filter does. Pure so it's testable without the search page.
export function isNonTrivialSearch(
  where: string,
  filters: unknown[] | undefined,
): boolean {
  return isNonEmptyWhereExpr(where) || (filters?.length ?? 0) > 0;
}
