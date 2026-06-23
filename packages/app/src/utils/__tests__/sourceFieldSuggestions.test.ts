import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getSourceConfigPairingWarnings,
  inferSourceFieldCandidates,
} from '@/utils/sourceFieldSuggestions';

const col = (name: string, type: string): ColumnMetaType => ({ name, type });

describe('inferSourceFieldCandidates', () => {
  it('recommends an exact canonical name match', () => {
    const columns = [
      col('Timestamp', 'DateTime64(9)'),
      col('Body', 'String'),
      col('ServiceName', 'LowCardinality(String)'),
    ];
    expect(
      inferSourceFieldCandidates(columns, 'bodyExpression', SourceKind.Log),
    ).toEqual({ canonical: 'Body', alternates: [] });
  });

  it('matches canonical names case-insensitively', () => {
    const columns = [col('traceid', 'String')];
    expect(
      inferSourceFieldCandidates(columns, 'traceIdExpression', SourceKind.Log),
    ).toEqual({ canonical: 'traceid', alternates: [] });
  });

  it('keeps columns that differ only by case rather than dropping one', () => {
    const columns = [col('Body', 'String'), col('BODY', 'String')];
    expect(
      inferSourceFieldCandidates(columns, 'bodyExpression', SourceKind.Log),
    ).toEqual({ canonical: 'Body', alternates: ['BODY'] });
  });

  it('picks the first column in table order as canonical on a case collision', () => {
    const columns = [col('BODY', 'String'), col('Body', 'String')];
    expect(
      inferSourceFieldCandidates(columns, 'bodyExpression', SourceKind.Log),
    ).toEqual({ canonical: 'BODY', alternates: ['Body'] });
  });

  it('surfaces every case-colliding Map column as an alternate', () => {
    const columns = [
      col('Attributes', 'Map(String, String)'),
      col('ATTRIBUTES', 'Map(String, String)'),
    ];
    expect(
      inferSourceFieldCandidates(
        columns,
        'eventAttributesExpression',
        SourceKind.Log,
      ),
    ).toEqual({ canonical: 'Attributes', alternates: ['ATTRIBUTES'] });
  });

  it('lists other name-matched columns as alternates (not every string column)', () => {
    const columns = [
      col('Body', 'String'),
      col('message', 'String'),
      col('msg', 'String'),
      col('some_unrelated_string', 'String'),
    ];
    expect(
      inferSourceFieldCandidates(columns, 'bodyExpression', SourceKind.Log),
    ).toEqual({ canonical: 'Body', alternates: ['message', 'msg'] });
  });

  it('resolves eventAttributesExpression per source kind', () => {
    const columns = [
      col('LogAttributes', 'Map(String, String)'),
      col('SpanAttributes', 'Map(LowCardinality(String), String)'),
    ];
    expect(
      inferSourceFieldCandidates(
        columns,
        'eventAttributesExpression',
        SourceKind.Log,
      ).canonical,
    ).toBe('LogAttributes');
    expect(
      inferSourceFieldCandidates(
        columns,
        'eventAttributesExpression',
        SourceKind.Trace,
      ).canonical,
    ).toBe('SpanAttributes');
  });

  it('recommends none but lists all when multiple unnamed Map columns exist', () => {
    const columns = [
      col('vendor_a', 'Map(String, String)'),
      col('vendor_b', 'Map(String, String)'),
    ];
    expect(
      inferSourceFieldCandidates(
        columns,
        'resourceAttributesExpression',
        SourceKind.Log,
      ),
    ).toEqual({ canonical: undefined, alternates: ['vendor_a', 'vendor_b'] });
  });

  it('recommends a lone Map column for an attributes field', () => {
    const columns = [col('attrs', 'Map(String, String)')];
    expect(
      inferSourceFieldCandidates(
        columns,
        'resourceAttributesExpression',
        SourceKind.Log,
      ),
    ).toEqual({ canonical: 'attrs', alternates: [] });
  });

  it('matches TraceId on UUID / FixedString(16) but not FixedString(8)', () => {
    expect(
      inferSourceFieldCandidates(
        [col('TraceId', 'UUID')],
        'traceIdExpression',
        SourceKind.Log,
      ).canonical,
    ).toBe('TraceId');
    expect(
      inferSourceFieldCandidates(
        [col('TraceId', 'FixedString(16)')],
        'traceIdExpression',
        SourceKind.Log,
      ).canonical,
    ).toBe('TraceId');
    expect(
      inferSourceFieldCandidates(
        [col('TraceId', 'FixedString(8)')],
        'traceIdExpression',
        SourceKind.Log,
      ),
    ).toEqual({ canonical: undefined, alternates: [] });
  });

  it('matches SpanId on FixedString(8)', () => {
    expect(
      inferSourceFieldCandidates(
        [col('SpanId', 'FixedString(8)')],
        'spanIdExpression',
        SourceKind.Log,
      ).canonical,
    ).toBe('SpanId');
  });

  it('treats LowCardinality(String) and Nullable(String) as stringy', () => {
    expect(
      inferSourceFieldCandidates(
        [col('Body', 'LowCardinality(String)')],
        'bodyExpression',
        SourceKind.Log,
      ).canonical,
    ).toBe('Body');
    expect(
      inferSourceFieldCandidates(
        [col('Body', 'Nullable(String)')],
        'bodyExpression',
        SourceKind.Log,
      ).canonical,
    ).toBe('Body');
  });

  it('excludes type-incompatible columns', () => {
    expect(
      inferSourceFieldCandidates(
        [col('Body', 'Int64')],
        'bodyExpression',
        SourceKind.Log,
      ),
    ).toEqual({ canonical: undefined, alternates: [] });
  });
});

describe('getSourceConfigPairingWarnings', () => {
  it('warns when Body is set but Implicit Column is empty, suggesting Body as the fix', () => {
    const warnings = getSourceConfigPairingWarnings({
      kind: SourceKind.Log,
      bodyExpression: 'Body',
      implicitColumnExpression: '',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('implicitColumnExpression');
    expect(warnings[0].suggestedFix).toEqual({
      field: 'implicitColumnExpression',
      value: 'Body',
    });
  });

  it('warns when Implicit Column is set but Body is empty, suggesting Implicit as the fix', () => {
    const warnings = getSourceConfigPairingWarnings({
      kind: SourceKind.Log,
      bodyExpression: '',
      implicitColumnExpression: 'Body',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('bodyExpression');
    expect(warnings[0].suggestedFix).toEqual({
      field: 'bodyExpression',
      value: 'Body',
    });
  });

  it('does not warn when both are set', () => {
    expect(
      getSourceConfigPairingWarnings({
        kind: SourceKind.Log,
        bodyExpression: 'Body',
        implicitColumnExpression: 'Body',
      }),
    ).toEqual([]);
  });

  it('does not warn when both are empty', () => {
    expect(
      getSourceConfigPairingWarnings({
        kind: SourceKind.Log,
        bodyExpression: '',
        implicitColumnExpression: '',
      }),
    ).toEqual([]);
    expect(getSourceConfigPairingWarnings({ kind: SourceKind.Log })).toEqual(
      [],
    );
  });

  it('treats whitespace-only values as empty', () => {
    const warnings = getSourceConfigPairingWarnings({
      kind: SourceKind.Log,
      bodyExpression: '   ',
      implicitColumnExpression: 'Body',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('bodyExpression');
  });

  it('returns no warnings for non-log sources even when only one field is set', () => {
    const fields = { bodyExpression: 'Body', implicitColumnExpression: '' };
    expect(
      getSourceConfigPairingWarnings({ kind: SourceKind.Trace, ...fields }),
    ).toEqual([]);
    expect(
      getSourceConfigPairingWarnings({ kind: SourceKind.Metric, ...fields }),
    ).toEqual([]);
  });
});
