import {
  NumberFormat,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import { LLMExpressions, LLMLogExpressions } from '@/llm/lib/expressions';

/** Props shared by every LLM dashboard chart component. */
export interface LLMChartProps {
  source: TTraceSource;
  expressions: LLMExpressions;
  dateRange: [Date, Date];
  where: string;
  whereLanguage: 'sql' | 'lucene';
  /**
   * When set, every chart is additionally scoped to this session id (matched
   * via the cross-dialect session expression).
   */
  sessionId?: string;
  /** Correlated log source for LLM log events, when one is selected. */
  logSource?: TLogSource;
  logExpressions?: LLMLogExpressions;
}

export const TOKEN_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number',
  mantissa: 1,
  thousandSeparated: true,
  average: true,
};

export const COST_USD_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'currency',
  mantissa: 2,
  thousandSeparated: true,
  currencySymbol: '$',
};
