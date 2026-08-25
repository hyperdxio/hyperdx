import { makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  baseLLMChartConfig,
  buildSessionCondition,
} from '@/llm/dashboard/chartConfig';
import { getLLMExpressions, LLM_COST_SQL_ALIAS } from '@/llm/lib/expressions';

const TRACE_SOURCE = makeTraceSource();

const expressions = getLLMExpressions(TRACE_SOURCE, []);

const baseProps = {
  source: TRACE_SOURCE,
  expressions,
  dateRange: [new Date(0), new Date(1000)] as [Date, Date],
  where: '',
  whereLanguage: 'sql' as const,
};

describe('buildSessionCondition', () => {
  it('escapes the session id value', () => {
    const condition = buildSessionCondition(
      expressions.sessionId,
      "ses_1'; DROP TABLE x --",
    );
    expect(condition).toContain(expressions.sessionId);
    expect(condition).toContain("'ses_1\\'; DROP TABLE x --'");
  });
});

describe('baseLLMChartConfig session scoping', () => {
  it('adds no session filter by default', () => {
    const config = baseLLMChartConfig(baseProps);
    expect(config.filters).toEqual([
      { type: 'sql', condition: expressions.isLLMSpan },
    ]);
  });

  it('appends the session filter to every chart when sessionId is set', () => {
    const config = baseLLMChartConfig({ ...baseProps, sessionId: 'ses_123' });
    expect(config.filters).toHaveLength(2);
    expect(config.filters[1]).toEqual({
      type: 'sql',
      condition: buildSessionCondition(expressions.sessionId, 'ses_123'),
    });
  });

  it('keeps extra filters after the session filter', () => {
    const config = baseLLMChartConfig({
      ...baseProps,
      sessionId: 'ses_123',
      extraFilters: [{ type: 'sql', condition: '1=1' }],
    });
    expect(config.filters).toHaveLength(3);
    expect(config.filters[2]).toEqual({ type: 'sql', condition: '1=1' });
  });

  it('binds the cost expression once as a WITH expression alias', () => {
    // The cost expression embeds the model price catalog (~70 KiB of SQL);
    // charts referencing it more than once must go through the alias or the
    // rendered query exceeds ClickHouse's 256 KiB max_query_size.
    const config = baseLLMChartConfig(baseProps);
    expect(config.with).toEqual([
      {
        name: LLM_COST_SQL_ALIAS,
        sql: { sql: expressions.costUsd, params: {} },
        isSubquery: false,
      },
    ]);
  });
});
