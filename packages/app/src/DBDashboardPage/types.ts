import {
  SearchCondition,
  SearchConditionLanguage,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';

export type DashboardQueryFormValues = {
  granularity: SQLInterval | 'auto';
  where: SearchCondition;
  whereLanguage: SearchConditionLanguage;
};

export type MoveTarget = {
  containerId: string;
  tabId?: string;
  label: string;
  // For tabs: all tabs in order with the target tab ID
  allTabs?: { id: string; title: string }[];
};
