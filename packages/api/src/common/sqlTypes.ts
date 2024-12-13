// Derived from SQL grammar spec
// See: https://ronsavage.github.io/SQL/sql-2003-2.bnf.html#query%20specification

export type SQLInterval =
  | `${number} second`
  | `${number} minute`
  | `${number} hour`
  | `${number} day`;

export type SearchCondition = string;
export type SearchConditionLanguage = 'sql' | 'lucene' | undefined;
export type AggregateFunction =
  | 'avg'
  | 'count'
  | 'count_distinct'
  | 'max'
  | 'min'
  | 'quantile'
  | 'sum';
export type AggregateFunctionWithCombinators =
  | `${AggregateFunction}If`
  | `${AggregateFunction}IfState`
  | `${AggregateFunction}IfMerge`
  | `${AggregateFunction}State`
  | `${AggregateFunction}Merge`;
type RootValueExpression =
  | {
      aggFn: AggregateFunction | AggregateFunctionWithCombinators;
      aggCondition: SearchCondition;
      aggConditionLanguage?: SearchConditionLanguage;
      valueExpression: string;
    }
  | {
      aggFn: 'quantile';
      level: number;
      aggCondition: SearchCondition;
      aggConditionLanguage?: SearchConditionLanguage;
      valueExpression: string;
    }
  | {
      aggFn?: undefined;
      aggCondition?: undefined;
      aggConditionLanguage?: undefined;
      valueExpression: string; // always wrapped by aggFn, ex: col + 5, can contain aggregation functions ex. sum(col) + 5 with undefined aggregation
    };

export type DerivedColumn = RootValueExpression & { alias?: string }; // AS myColName

export type SelectList = DerivedColumn[] | string; // Serialized Select List

type SortSpecification = RootValueExpression & { ordering: 'ASC' | 'DESC' };
export type SortSpecificationList = SortSpecification[] | string;

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
