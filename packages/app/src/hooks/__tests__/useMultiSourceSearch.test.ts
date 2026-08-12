import { Filter } from '@hyperdx/common-utils/dist/types';

import {
  filterRootColumn,
  resolveExtraColumnsForSource,
  rootColumnOf,
  unresolvedColumns,
  unresolvedFilterColumns,
} from '@/hooks/useMultiSourceSearch';

describe('filterRootColumn', () => {
  it('extracts a plain column reference', () => {
    const filter: Filter = {
      type: 'sql_ast',
      operator: '=',
      left: 'ServiceName',
      right: "'cart'",
    };
    expect(filterRootColumn(filter)).toBe('ServiceName');
  });

  it('extracts the root of a map subscript', () => {
    const filter: Filter = {
      type: 'sql_ast',
      operator: '=',
      left: "LogAttributes['level']",
      right: "'error'",
    };
    expect(filterRootColumn(filter)).toBe('LogAttributes');
  });

  it('extracts a backticked identifier', () => {
    const filter: Filter = {
      type: 'sql_ast',
      operator: '=',
      left: '`weird-col`',
      right: "'x'",
    };
    expect(filterRootColumn(filter)).toBe('weird-col');
  });

  it('returns null for raw sql and lucene filters', () => {
    expect(
      filterRootColumn({ type: 'sql', condition: "Foo = 'bar'" }),
    ).toBeNull();
    expect(
      filterRootColumn({ type: 'lucene', condition: 'foo:bar' }),
    ).toBeNull();
  });
});

describe('unresolvedFilterColumns', () => {
  const filters: Filter[] = [
    { type: 'sql_ast', operator: '=', left: 'ServiceName', right: "'cart'" },
    { type: 'sql_ast', operator: '=', left: 'StatusCode', right: "'Unset'" },
    { type: 'sql', condition: 'anything' },
  ];

  it('reports columns the source lacks', () => {
    expect(
      unresolvedFilterColumns(filters, new Set(['ServiceName', 'Body'])),
    ).toEqual(['StatusCode']);
  });

  it('is empty when every attributable column resolves', () => {
    expect(
      unresolvedFilterColumns(filters, new Set(['ServiceName', 'StatusCode'])),
    ).toEqual([]);
  });

  it('is empty (not excluding) while columns are still unknown', () => {
    expect(unresolvedFilterColumns(filters, undefined)).toEqual([]);
  });
});

describe('resolveExtraColumnsForSource', () => {
  it('projects the column where present and NULL where missing', () => {
    expect(
      resolveExtraColumnsForSource(
        ['ServiceName', 'StatusCode', 'weird col'],
        new Set(['ServiceName', 'weird col']),
      ),
    ).toEqual([
      { name: 'ServiceName', expression: 'ServiceName' },
      { name: 'StatusCode', expression: null },
      { name: 'weird col', expression: '`weird col`' },
    ]);
  });
});

describe('rootColumnOf', () => {
  it('returns a plain column unchanged', () => {
    expect(rootColumnOf('ServiceName')).toBe('ServiceName');
  });

  it('returns the root of a map subscript or JSON path', () => {
    expect(rootColumnOf("LogAttributes['level']")).toBe('LogAttributes');
    expect(rootColumnOf('LogAttributes.level')).toBe('LogAttributes');
  });

  it('unquotes a backticked identifier', () => {
    expect(rootColumnOf('`weird-col`')).toBe('weird-col');
  });

  it('returns null for something not rooted at a column', () => {
    expect(rootColumnOf("'a literal'")).toBeNull();
    expect(rootColumnOf('123')).toBeNull();
  });
});

describe('unresolvedColumns', () => {
  const columns = new Set(['ServiceName', 'Body', 'LogAttributes']);

  it('reports references the source lacks', () => {
    expect(unresolvedColumns(['ServiceName', 'StatusCode'], columns)).toEqual([
      'StatusCode',
    ]);
  });

  it('resolves map and JSON references through their root column', () => {
    expect(
      unresolvedColumns(
        ["LogAttributes['level']", 'SpanAttributes.http'],
        columns,
      ),
    ).toEqual(['SpanAttributes']);
  });

  it('ignores references it cannot attribute to a column', () => {
    expect(unresolvedColumns([null, "'literal'"], columns)).toEqual([]);
  });

  it('excludes nobody while the column list is still unknown', () => {
    expect(unresolvedColumns(['StatusCode'], undefined)).toEqual([]);
  });

  it('dedupes a column referenced more than once', () => {
    expect(unresolvedColumns(['StatusCode', 'StatusCode'], columns)).toEqual([
      'StatusCode',
    ]);
  });
});
