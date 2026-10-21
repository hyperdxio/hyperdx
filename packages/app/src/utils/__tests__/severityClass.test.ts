import { buildSeverityClassExpressionV1 } from '@hyperdx/common-utils/dist/core/severity';
import type { TSource } from '@hyperdx/common-utils/dist/types';

import {
  cleanClickHouseExpression,
  toQuotedClickHouseKeyExpression,
} from '@/components/DBSearchPageFilters/utils';
import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  getLogsResultTypeQuery,
  getSeverityClassKey,
} from '@/utils/severityClass';

const logSource = makeLogSource({ severityNumberExpression: 'SeverityNumber' });

const otelKey = buildSeverityClassExpressionV1({
  numberExpr: 'SeverityNumber',
  textExpr: 'SeverityText',
});

describe('getSeverityClassKey', () => {
  it('builds the key from the severity expressions', () => {
    expect(getSeverityClassKey(logSource)).toBe(otelKey);
    expect(
      getSeverityClassKey({
        ...logSource,
        knownColumnsListExpression: 'Timestamp, SeverityText, SeverityNumber',
      }),
    ).toBe(otelKey);
  });

  it('leaves out the text when the source has no severity text', () => {
    expect(
      getSeverityClassKey({ ...logSource, severityTextExpression: ' ' }),
    ).toBe(buildSeverityClassExpressionV1({ numberExpr: 'SeverityNumber' }));
  });

  it.each<[string, TSource | undefined]>([
    ['no source', undefined],
    ['a trace source', makeTraceSource()],
    [
      'no severity number expression',
      { ...logSource, severityNumberExpression: undefined },
    ],
    [
      'a known columns list without the number',
      { ...logSource, knownColumnsListExpression: 'Timestamp, SeverityText' },
    ],
    [
      'a known columns list without the text',
      { ...logSource, knownColumnsListExpression: 'Timestamp, SeverityNumber' },
    ],
    [
      'a backtick in an expression',
      { ...logSource, severityTextExpression: '`SeverityText`' },
    ],
    [
      'an AND in an expression',
      {
        ...logSource,
        severityNumberExpression: 'if(a AND b, SeverityNumber, 0)',
      },
    ],
    [
      'an OR in an expression',
      {
        ...logSource,
        severityTextExpression: "if(SeverityText = '' or x, 'info', '')",
      },
    ],
  ])('has no key for %s', (_, source) => {
    expect(getSeverityClassKey(source)).toBeUndefined();
  });

  it('survives the URL filter key cleanup unchanged', () => {
    expect(cleanClickHouseExpression(otelKey)).toBe(otelKey);
    expect(
      toQuotedClickHouseKeyExpression(
        otelKey,
        new Set(['SeverityNumber', 'SeverityText']),
      ),
    ).toBe(otelKey);
  });
});

describe('getLogsResultTypeQuery', () => {
  const where = 'k8s.pod.name:"api"';
  const noNumber = { ...logSource, severityNumberExpression: undefined };

  it.each([
    [
      'class filter for errors on sources with the field',
      logSource,
      'error',
      {
        where,
        filters: [
          { type: 'sql', condition: `${otelKey} IN ('FATAL', 'ERROR')` },
        ],
      },
    ],
    [
      'Lucene term for errors on sources without it',
      noNumber,
      'error',
      { where: `${where} Severity:err` },
    ],
    ['no severity scope for all', logSource, 'all', { where }],
  ] as const)('%s', (_, source, resultType, expected) => {
    expect(getLogsResultTypeQuery({ source, where, resultType })).toEqual(
      expected,
    );
  });
});
