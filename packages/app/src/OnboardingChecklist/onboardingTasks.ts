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

// UI render order for the product-usage phase, decoupled from the enum order in
// common-utils. Typed as an exhaustive Record<OnboardingTaskId, number> so a new
// id added to ONBOARDING_TASK_IDS is a compile error here until it's given a
// weight — and because the order is derived by sorting ONBOARDING_TASK_IDS
// (the SSOT), that new id always renders and can't be silently untracked.
const PRODUCT_TASK_ORDER_WEIGHT: Record<OnboardingTaskId, number> = {
  advancedQuery: 0,
  dashboard: 1,
  alert: 2,
  mcp: 3,
};

export const PRODUCT_TASK_ORDER: OnboardingTaskId[] = [
  ...ONBOARDING_TASK_IDS,
].sort((a, b) => PRODUCT_TASK_ORDER_WEIGHT[a] - PRODUCT_TASK_ORDER_WEIGHT[b]);
