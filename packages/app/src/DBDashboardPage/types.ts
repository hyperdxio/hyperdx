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
