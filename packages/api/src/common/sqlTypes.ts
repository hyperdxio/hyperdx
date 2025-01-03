// Derived from SQL grammar spec
// See: https://ronsavage.github.io/SQL/sql-2003-2.bnf.html#query%20specification

import { z } from 'zod';

import {
  AggregateFunctionSchema,
  AggregateFunctionWithCombinatorsSchema,
  DerivedColumnSchema,
  SearchConditionLanguageSchema,
  SearchConditionSchema,
  SelectListSchema,
  SortSpecificationListSchema,
  SQLIntervalSchema,
} from '@/common/commonTypes';

export type SQLInterval = z.infer<typeof SQLIntervalSchema>;

export type SearchCondition = z.infer<typeof SearchConditionSchema>;
export type SearchConditionLanguage = z.infer<
  typeof SearchConditionLanguageSchema
>;
export type AggregateFunction = z.infer<typeof AggregateFunctionSchema>;
export type AggregateFunctionWithCombinators = z.infer<
  typeof AggregateFunctionWithCombinatorsSchema
>;

export type DerivedColumn = z.infer<typeof DerivedColumnSchema>;

export type SelectList = z.infer<typeof SelectListSchema>;

export type SortSpecificationList = z.infer<typeof SortSpecificationListSchema>;

type Limit = { limit?: number; offset?: number };

export type SelectSQLStatement = {
  select: SelectList;
  from: { databaseName: string; tableName: string };
  where: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  groupBy?: SelectList;
  having?: SearchCondition;
  havingLanguage?: SearchConditionLanguage;
  orderBy?: SortSpecificationList;
  limit?: Limit;
};
