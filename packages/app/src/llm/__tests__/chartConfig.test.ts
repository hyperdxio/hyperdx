import { makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  appendWhereClause,
  baseLLMChartConfig,
  buildDeltaFilterClause,
  buildSessionCondition,
  buildTrimmedDeltaSelect,
  DELTA_ATTRIBUTE_VALUE_MAX_LENGTH,
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

describe('buildDeltaFilterClause', () => {
  const prop = "SpanAttributes['gen_ai.request.model']";

  it('builds escaped SQL equality and inequality clauses', () => {
    expect(buildDeltaFilterClause(prop, 'gpt-5.1', 'include', 'sql')).toBe(
      `${prop} = 'gpt-5.1'`,
    );
    expect(buildDeltaFilterClause(prop, 'gpt-5.1', 'exclude', 'sql')).toBe(
      `${prop} != 'gpt-5.1'`,
    );
    // 'only' behaves like include (single where input, no value set).
    expect(buildDeltaFilterClause(prop, 'gpt-5.1', 'only', 'sql')).toBe(
      `${prop} = 'gpt-5.1'`,
    );
  });

  it('escapes SQL values', () => {
    expect(buildDeltaFilterClause('ServiceName', "a'b", 'include', 'sql')).toBe(
      "ServiceName = 'a\\'b'",
    );
  });

  it('converts bracket notation to lucene dot notation', () => {
    expect(buildDeltaFilterClause(prop, 'gpt-5.1', 'include', 'lucene')).toBe(
      'SpanAttributes.gen_ai.request.model:"gpt-5.1"',
    );
    expect(buildDeltaFilterClause(prop, 'gpt-5.1', 'exclude', 'lucene')).toBe(
      '-SpanAttributes.gen_ai.request.model:"gpt-5.1"',
    );
  });

  it('keeps plain columns and quotes lucene values', () => {
    expect(
      buildDeltaFilterClause('ServiceName', 'my "svc"', 'include', 'lucene'),
    ).toBe('ServiceName:"my \\"svc\\""');
  });
});

describe('appendWhereClause', () => {
  it('returns the clause alone when the where is empty', () => {
    expect(appendWhereClause('', "a = 'b'", 'sql')).toBe("a = 'b'");
    expect(appendWhereClause('  ', 'a:"b"', 'lucene')).toBe('a:"b"');
  });

  it('parenthesizes the existing SQL where before ANDing', () => {
    expect(appendWhereClause('x = 1 OR y = 2', "a = 'b'", 'sql')).toBe(
      "(x = 1 OR y = 2) AND a = 'b'",
    );
  });

  it('space-joins lucene terms (implicit AND)', () => {
    expect(appendWhereClause('level:error', 'a:"b"', 'lucene')).toBe(
      'level:error a:"b"',
    );
  });
});

describe('buildTrimmedDeltaSelect', () => {
  it('trims oversized attribute values on plain Map columns', () => {
    expect(buildTrimmedDeltaSelect(TRACE_SOURCE, [])).toBe(
      '* EXCEPT (SpanAttributes), ' +
        `mapFilter((k, v) -> length(v) <= ${DELTA_ATTRIBUTE_VALUE_MAX_LENGTH}, SpanAttributes) AS SpanAttributes`,
    );
  });

  it('falls back to * for JSON-typed attribute columns', () => {
    expect(buildTrimmedDeltaSelect(TRACE_SOURCE, ['SpanAttributes'])).toBe('*');
  });

  it('falls back to * when the attribute field is a derived expression', () => {
    const source = {
      ...TRACE_SOURCE,
      eventAttributesExpression: "mapConcat(SpanAttributes, map('a', 'b'))",
    };
    expect(buildTrimmedDeltaSelect(source, [])).toBe('*');
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

  it('binds the cost expression once as a WITH expression alias when opted in', () => {
    // The cost expression embeds the model price catalog (~70 KiB of SQL);
    // charts referencing it more than once must go through the alias or the
    // rendered query exceeds ClickHouse's 256 KiB max_query_size.
    const config = baseLLMChartConfig({ ...baseProps, withCostAlias: true });
    expect(config.with).toEqual([
      {
        name: LLM_COST_SQL_ALIAS,
        sql: { sql: expressions.costUsd, params: {} },
        isSubquery: false,
      },
    ]);
  });

  it('skips the cost binding by default while cost display is disabled', () => {
    // IS_LLM_COST_ENABLED defaults off, so no chart selects the alias and
    // every dashboard query stays ~70 KiB smaller.
    const config = baseLLMChartConfig(baseProps);
    expect(config).not.toHaveProperty('with');
  });
});
