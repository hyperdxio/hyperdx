import { describe, expect, it } from '@jest/globals';

import type { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';

import { buildColumnMap, getRowWhere } from '@/shared/useRowWhere';

describe('buildColumnMap', () => {
  it('quotes a column name that is not a bare identifier', () => {
    const meta: ColumnMetaType[] = [{ name: 'x-host-header', type: 'String' }];

    const where = getRowWhere(
      { 'x-host-header': '136.124.33.174' },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe("`x-host-header`='136.124.33.174'");
  });

  it('prefers the alias expression over quoting the column name', () => {
    const meta: ColumnMetaType[] = [{ name: 'x-host-header', type: 'String' }];
    const aliasMap = { 'x-host-header': 'client_ip' };

    const result = getRowWhere(
      { 'x-host-header': '136.124.33.174' },
      buildColumnMap(meta, aliasMap),
      aliasMap,
    );

    expect(result.where).toBe("client_ip='136.124.33.174'");
    expect(result.aliasWith).toEqual([
      {
        name: 'x-host-header',
        sql: { sql: 'client_ip', params: {} },
        isSubquery: false,
      },
    ]);
  });

  it('handles a Dynamic column whose name needs quoting', () => {
    const meta: ColumnMetaType[] = [
      { name: 'x-host-header', type: 'Dynamic' },
      { name: 'lowered', type: 'Dynamic' },
    ];
    const aliasMap = { lowered: 'lower(Body)' };

    const where = getRowWhere(
      { 'x-host-header': 'null', lowered: 'null' },
      buildColumnMap(meta, aliasMap),
      aliasMap,
    ).where;

    expect(where).toBe('isNull(`x-host-header`) AND isNull(lower(Body))');
  });

  it('leaves an expression-shaped result column name alone', () => {
    const meta: ColumnMetaType[] = [
      { name: "ResourceAttributes['service.name']", type: 'String' },
    ];

    const where = getRowWhere(
      { "ResourceAttributes['service.name']": 'api' },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe("ResourceAttributes['service.name']='api'");
  });
});
