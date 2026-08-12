import { Filter } from '@hyperdx/common-utils/dist/types';

import {
  filterRootColumn,
  resolveExtraColumnsForSource,
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
