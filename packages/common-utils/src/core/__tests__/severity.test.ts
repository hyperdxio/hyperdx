import {
  collapseSeverityClass,
  getSeverityClass,
  getSeverityLabel,
  getSeverityShortName,
  NUMBER_RANGES,
  TEXT_PREFIX_RULES,
} from '@/core/severity';

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
    ['17', 'ERROR'],
    ['+17', 'ERROR'],
    ['017', 'ERROR'],
  ])('classifies number %p as %p', (severityNumber, expected) => {
    expect(getSeverityClass({ severityNumber })).toBe(expected);
  });

  it('prefers the number over the text', () => {
    expect(getSeverityClass({ severityNumber: 9, severityText: 'ERROR' })).toBe(
      'INFO',
    );
  });

  it.each([0, 25, 255, -1, 17.5, ' 17', '17 ', '0x11', '', null, undefined])(
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
    ['panic', 'FATAL'],
    ['dpanic', 'FATAL'],
    ['ftl', 'FATAL'],
    ['severe', 'ERROR'],
    ['wrn', 'WARN'],
  ])('classifies %p as %p', (severityText, expected) => {
    expect(getSeverityClass({ severityText })).toBe(expected);
  });

  it.each(['', ' error', 'E', 'log', 'Normal', null, undefined])(
    'classifies unmatched text %p as unknown',
    severityText => {
      expect(getSeverityClass({ severityNumber: 0, severityText })).toBe(
        'UNKNOWN',
      );
    },
  );

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
    ['UNKNOWN', undefined],
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
