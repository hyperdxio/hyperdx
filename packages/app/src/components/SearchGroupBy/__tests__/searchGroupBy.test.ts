import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  isCustomSearchGroupBy,
  resolveSearchGroupBy,
  retainGroupByByColumns,
  toGroupByField,
} from '@/components/SearchGroupBy/searchGroupBy';

const logSource = {
  kind: SourceKind.Log,
  severityTextExpression: 'SeverityText',
};
const traceSource = {
  kind: SourceKind.Trace,
  statusCodeExpression: 'StatusCode',
};

describe('resolveSearchGroupBy', () => {
  it('uses the source default when the param is absent', () => {
    expect(resolveSearchGroupBy(null, logSource)).toBe('SeverityText');
    expect(resolveSearchGroupBy(null, traceSource)).toBe('StatusCode');
    expect(resolveSearchGroupBy(null, undefined)).toBeUndefined();
  });

  it('means no grouping when the param is empty', () => {
    expect(resolveSearchGroupBy('', logSource)).toBeUndefined();
    expect(resolveSearchGroupBy('  ', logSource)).toBeUndefined();
  });

  it('uses the param when set', () => {
    expect(resolveSearchGroupBy('ServiceName', logSource)).toBe('ServiceName');
  });
});

describe('isCustomSearchGroupBy', () => {
  it('is false for the source default, implicit or explicit', () => {
    expect(isCustomSearchGroupBy(null, logSource)).toBe(false);
    expect(isCustomSearchGroupBy(' SeverityText ', logSource)).toBe(false);
  });

  it('is false with no grouping', () => {
    expect(isCustomSearchGroupBy('', logSource)).toBe(false);
    expect(isCustomSearchGroupBy(null, undefined)).toBe(false);
  });

  it('is true for anything else', () => {
    expect(isCustomSearchGroupBy('ServiceName', logSource)).toBe(true);
    expect(isCustomSearchGroupBy('SeverityText, ServiceName', logSource)).toBe(
      true,
    );
    expect(isCustomSearchGroupBy('ServiceName', undefined)).toBe(true);
  });
});

describe('toGroupByField', () => {
  it('leaves bare identifiers alone', () => {
    expect(toGroupByField(['ServiceName'], [], [])).toBe('ServiceName');
    expect(
      toGroupByField(['LogAttributes', 'a-b'], [], ['LogAttributes']),
    ).toBe("LogAttributes['a-b']");
  });

  it('backtick-quotes a root column that is not a bare identifier', () => {
    expect(toGroupByField(['dash-column'], [], [])).toBe('`dash-column`');
    expect(toGroupByField(['dash-map', 'k'], [], ['dash-map'])).toBe(
      "`dash-map`['k']",
    );
    expect(toGroupByField(['dash-json', 'a'], ['dash-json'], [])).toBe(
      '`dash-json`.`a`',
    );
  });
});

describe('retainGroupByByColumns', () => {
  const columns = new Set(['ServiceName', 'LogAttributes', 'Body']);

  it('leaves absent and empty params alone', () => {
    expect(retainGroupByByColumns(null, columns)).toEqual({
      kept: null,
      dropped: [],
    });
    expect(retainGroupByByColumns('', columns)).toEqual({
      kept: '',
      dropped: [],
    });
  });

  it('keeps columns and map/JSON keys whose root column exists', () => {
    const value =
      "ServiceName, LogAttributes['service.name'], `LogAttributes`.`a`, toString(Body)";
    expect(retainGroupByByColumns(value, columns)).toEqual({
      kept: value,
      dropped: [],
    });
  });

  it('drops missing columns and non-column expressions', () => {
    expect(
      retainGroupByByColumns(
        "ServiceName, SpanName, concat(Body, ServiceName), ResourceAttributes['x']",
        columns,
      ),
    ).toEqual({
      kept: 'ServiceName',
      dropped: [
        'SpanName',
        'concat(Body, ServiceName)',
        "ResourceAttributes['x']",
      ],
    });
  });

  it('matches quoted root columns by their unquoted name', () => {
    const value = "`dash-column`, `dash-map`['k']";
    expect(
      retainGroupByByColumns(value, new Set(['dash-column', 'dash-map'])),
    ).toEqual({ kept: value, dropped: [] });
  });

  it('treats a bracketed key containing a comma as one field', () => {
    expect(
      retainGroupByByColumns("LogAttributes['a,b'], SpanName", columns),
    ).toEqual({ kept: "LogAttributes['a,b']", dropped: ['SpanName'] });
  });

  it('falls back to the default when nothing is kept', () => {
    expect(retainGroupByByColumns('SpanName', columns)).toEqual({
      kept: null,
      dropped: ['SpanName'],
    });
  });
});
