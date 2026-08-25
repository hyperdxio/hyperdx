import { makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  baseLLMChartConfig,
  buildSessionCondition,
} from '@/llm/dashboard/chartConfig';
import { getLLMExpressions } from '@/llm/lib/expressions';

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
});
