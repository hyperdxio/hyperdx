import * as SQLParser from 'node-sql-parser';

import {
  buildSeverityClassExpressionV1,
  collapseSeverityClass,
  getSeverityClass,
  getSeverityLabel,
  getSeverityShortName,
  isSeverityClassKeyV1,
  NUMBER_RANGES,
  SEVERITY_CLASS_FACET_VALUES,
  TEXT_PREFIX_RULES,
} from '@/core/severity';
import {
  filtersToQuery,
  isRenderablePinnedFilter,
  isValidFilterCondition,
  parseQuery,
} from '@/filters';

describe('getSeverityClass', () => {
  it.each([
    [1, 'TRACE'],
    [4, 'TRACE'],
    [5, 'DEBUG'],
    [8, 'DEBUG'],
    [9, 'INFO'],
    [12, 'INFO'],
    [13, 'WARN'],
    [16, 'WARN'],
    [17, 'ERROR'],
    [20, 'ERROR'],
    [21, 'FATAL'],
    [24, 'FATAL'],
    [25, 'FATAL'],
    [255, 'FATAL'],
    [17.5, 'ERROR'],
    [1.5, 'TRACE'],
    [Infinity, 'FATAL'],
    ['17', 'ERROR'],
    ['017', 'ERROR'],
    ['18446744073709551615', 'FATAL'],
  ])('classifies number %p as %p', (severityNumber, expected) => {
    expect(getSeverityClass({ severityNumber })).toBe(expected);
  });

  it('prefers the number over the text', () => {
    expect(getSeverityClass({ severityNumber: 9, severityText: 'ERROR' })).toBe(
      'INFO',
    );
  });

  it.each([0, 0.5, -1, NaN, ' 17', '17.5', '-1', '', null, undefined, true])(
    'falls back to the text for number %p',
    severityNumber => {
      expect(getSeverityClass({ severityNumber, severityText: 'Warn' })).toBe(
        'WARN',
      );
    },
  );

  it.each(TEXT_PREFIX_RULES.map(r => [r.prefix, r.severityClass]))(
    'matches text prefix %p in any case as %p',
    (prefix, expected) => {
      const mixedCase = `${prefix[0].toUpperCase()}${prefix.slice(1)}X`;
      expect(getSeverityClass({ severityText: prefix.toUpperCase() })).toBe(
        expected,
      );
      expect(getSeverityClass({ severityText: mixedCase })).toBe(expected);
    },
  );

  it.each([
    ['information', 'INFO'],
    ['INF', 'INFO'],
    ['critical', 'ERROR'],
    ['SEVERE', 'ERROR'],
    ['dpanic', 'FATAL'],
    ['Panic', 'FATAL'],
    ['FTL', 'FATAL'],
    ['WRN', 'WARN'],
    ['DBG', 'DEBUG'],
    ['TRC', 'TRACE'],
    ['VRB', 'TRACE'],
  ])('classifies text %p as %p', (severityText, expected) => {
    expect(getSeverityClass({ severityNumber: 0, severityText })).toBe(
      expected,
    );
  });

  it.each([
    '',
    'E',
    'audit',
    '[error]',
    ' error',
    'log_error',
    'dbug',
    'ok',
    'unset',
    'ÉRROR',
    null,
    undefined,
  ])('classifies unmatched text %p as other', severityText => {
    expect(getSeverityClass({ severityNumber: 0, severityText })).toBe('OTHER');
  });

  it('keeps the ranges contiguous and four wide and the prefixes order-independent', () => {
    NUMBER_RANGES.forEach((range, i) => {
      expect(range.min).toBe(i * 4 + 1);
      expect(range.max).toBe(range.min + 3);
    });
    TEXT_PREFIX_RULES.forEach(a => {
      expect(a.prefix).toMatch(/^[a-z]+$/);
      TEXT_PREFIX_RULES.filter(b => b.prefix.startsWith(a.prefix)).forEach(b =>
        expect(b.severityClass).toBe(a.severityClass),
      );
    });
  });
});

describe('collapseSeverityClass', () => {
  it.each([
    ['FATAL', 'error'],
    ['ERROR', 'error'],
    ['WARN', 'warn'],
    ['INFO', undefined],
    ['DEBUG', undefined],
    ['TRACE', undefined],
    ['OTHER', undefined],
  ] as const)('collapses %p to %p', (severityClass, expected) => {
    expect(collapseSeverityClass(severityClass)).toBe(expected);
  });
});

describe('getSeverityShortName', () => {
  it.each([
    [1, 'TRACE'],
    [4, 'TRACE4'],
    [10, 'INFO2'],
    [21, 'FATAL'],
    [24, 'FATAL4'],
    ['10', 'INFO2'],
    [0, undefined],
  ])('names %p %p', (severityNumber, expected) => {
    expect(getSeverityShortName(severityNumber)).toBe(expected);
  });
});

describe('getSeverityLabel', () => {
  it.each([
    [9, 'info', 'INFO'],
    [9, 'Informational', 'INFO (Informational)'],
    [10, 'info', 'INFO2 (info)'],
    [13, 'warning', 'WARN (warning)'],
    [17, 'info', 'ERROR (info)'],
    [17, '', 'ERROR'],
    [18, null, 'ERROR2'],
    [0, 'error', 'error'],
    [null, 'Warning', 'Warning'],
    [25, 'info', 'info'],
    [0, '', undefined],
    [undefined, null, undefined],
  ])('labels %p with %p as %p', (severityNumber, severityText, expected) => {
    expect(getSeverityLabel({ severityNumber, severityText })).toBe(expected);
  });
});

describe('buildSeverityClassExpressionV1', () => {
  const sqlParser = new SQLParser.Parser();
  const OTEL_KEY =
    "multiIf(SeverityNumber >= 21, 'FATAL', SeverityNumber >= 17, 'ERROR', SeverityNumber >= 13, 'WARN', SeverityNumber >= 9, 'INFO', SeverityNumber >= 5, 'DEBUG', SeverityNumber >= 1, 'TRACE', SeverityText ILIKE 'fatal%', 'FATAL', SeverityText ILIKE 'emerg%', 'FATAL', SeverityText ILIKE 'panic%', 'FATAL', SeverityText ILIKE 'dpanic%', 'FATAL', SeverityText ILIKE 'ftl%', 'FATAL', SeverityText ILIKE 'err%', 'ERROR', SeverityText ILIKE 'crit%', 'ERROR', SeverityText ILIKE 'alert%', 'ERROR', SeverityText ILIKE 'severe%', 'ERROR', SeverityText ILIKE 'warn%', 'WARN', SeverityText ILIKE 'wrn%', 'WARN', SeverityText ILIKE 'inf%', 'INFO', SeverityText ILIKE 'notice%', 'INFO', SeverityText ILIKE 'debug%', 'DEBUG', SeverityText ILIKE 'dbg%', 'DEBUG', SeverityText ILIKE 'trace%', 'TRACE', SeverityText ILIKE 'trc%', 'TRACE', SeverityText ILIKE 'verbose%', 'TRACE', SeverityText ILIKE 'vrb%', 'TRACE', 'OTHER')";

  const otelKey = buildSeverityClassExpressionV1({
    numberExpr: 'SeverityNumber',
    textExpr: 'SeverityText',
  });
  const numberOnlyKey = buildSeverityClassExpressionV1({
    numberExpr: 'SeverityNumber',
  });
  const mapKey = buildSeverityClassExpressionV1({
    numberExpr: "toUInt8OrZero(LogAttributes['severity_number'])",
    textExpr: "LogAttributes['level']",
  });

  // Stored filters hold this exact string; changing it needs a V2 builder.
  it('builds the frozen V1 keys', () => {
    expect(otelKey).toBe(OTEL_KEY);
    expect(numberOnlyKey).toBe(
      "multiIf(SeverityNumber >= 21, 'FATAL', SeverityNumber >= 17, 'ERROR', SeverityNumber >= 13, 'WARN', SeverityNumber >= 9, 'INFO', SeverityNumber >= 5, 'DEBUG', SeverityNumber >= 1, 'TRACE', 'OTHER')",
    );
    expect(mapKey).toBe(
      OTEL_KEY.replaceAll(
        'SeverityNumber',
        "toUInt8OrZero(LogAttributes['severity_number'])",
      ).replaceAll('SeverityText', "LogAttributes['level']"),
    );
  });

  it.each([
    ['the OTel source', otelKey],
    ['a number-only source', numberOnlyKey],
    ['map attributes', mapKey],
  ])('recognizes and round-trips the key for %s', (_, key) => {
    expect(isSeverityClassKeyV1(key)).toBe(true);

    const [included, excluded] = filtersToQuery({
      [key]: {
        included: new Set(['ERROR', 'FATAL']),
        excluded: new Set(['OTHER']),
      },
    });

    expect(parseQuery([included, excluded]).filters).toEqual({
      [key]: {
        included: new Set(['ERROR', 'FATAL']),
        excluded: new Set(['OTHER']),
      },
    });
    for (const filter of [included, excluded]) {
      expect(filter.type).toBe('sql');
      expect(isValidFilterCondition(filter.condition, 'sql')).toBe(true);
      expect(isRenderablePinnedFilter(filter)).toBe(true);
      // renderChartConfig rewrites conditions through node-sql-parser when the
      // table has materialized columns.
      const sql = `SELECT * FROM \`t\` WHERE ${filter.condition}`;
      expect(
        sqlParser.sqlify(sqlParser.astify(sql, { database: 'Postgresql' })),
      ).toBe(sql);
    }
  });

  it('recognizes a number expression that contains the first branch', () => {
    const key = buildSeverityClassExpressionV1({
      numberExpr: "if(x >= 21, 'FATAL', 1)",
      textExpr: 'SeverityText',
    });
    expect(isSeverityClassKeyV1(key)).toBe(true);
  });

  it.each([
    'SeverityText',
    OTEL_KEY.slice(0, -1),
    OTEL_KEY.replace('SeverityNumber', 'SeverityNumber2'),
    OTEL_KEY.replace('SeverityText', 'SeverityText2'),
    OTEL_KEY.replace(" SeverityText ILIKE 'verbose%', 'TRACE',", ''),
  ])('rejects other key %#', key => {
    expect(isSeverityClassKeyV1(key)).toBe(false);
  });

  it('lists the facet values in severity order', () => {
    expect(SEVERITY_CLASS_FACET_VALUES).toEqual([
      'TRACE',
      'DEBUG',
      'INFO',
      'WARN',
      'ERROR',
      'FATAL',
      'OTHER',
    ]);
  });
});
