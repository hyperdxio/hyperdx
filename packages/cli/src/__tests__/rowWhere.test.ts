import { describe, expect, it } from '@jest/globals';

import type { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';

import { buildColumnMap, getRowWhere } from '@/shared/useRowWhere';

type Sha256WhereKind = 'json' | 'leftUtf8';

type Sha256TestCase = {
  /** ClickHouse expression this hash was verified against. */
  clickHouse: string;
  columnMeta: ColumnMetaType[];
  input: string;
  expected: string;
  whereKind: Sha256WhereKind;
};

const SHA256_TEST_CASES: Record<string, Sha256TestCase> = {
  'actual log line': {
    clickHouse: 'lower(hex(SHA256(<json log line>)))',
    columnMeta: [{ name: 'Body', type: 'JSON' }],
    input:
      '{"caller":"github.com/cloudzero/cloudzero-agent/app/domain/shipper/shipper.go:289","level":"info","message":"Successfully ran the shipper cycle","time":"2026-10-18T00:00:03Z","version":"5d05872b1f292e4bf481c61b187494b9bafff6a8.1.2.10-2026-03-24_02:00:46PM"}',
    expected: '9bf1e18eb79cfe32fa7abb7c2b5370085a73eb299ffaaa526393084c8681c0b8',
    whereKind: 'json',
  },
  '600-char string': {
    clickHouse: "lower(hex(SHA256(repeat('a', 600))))",
    columnMeta: [{ name: 'description', type: 'String' }],
    input: 'a'.repeat(600),
    expected: 'ba35c170729417f1499e0886e7e12fcdb4ab00ad411110ae1e888c766d4ed70d',
    whereKind: 'leftUtf8',
  },
  '2000-char string truncated to 1000 code points': {
    clickHouse: "lower(hex(SHA256(leftUTF8(repeat('a', 2000), 1000))))",
    columnMeta: [{ name: 'description', type: 'String' }],
    input: 'a'.repeat(2000),
    expected: '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    whereKind: 'leftUtf8',
  },
  '600 emoji code points': {
    clickHouse: "lower(hex(SHA256(leftUTF8(repeat('😀', 600), 1000))))",
    columnMeta: [{ name: 'description', type: 'String' }],
    input: '😀'.repeat(600),
    expected: '7f22fd88b289648f5f2a8f290d1010a0cefcf260777d613f34f9fb7948db3e43',
    whereKind: 'leftUtf8',
  },
};

function sha256RowWhere(
  columnName: string,
  whereKind: Sha256WhereKind,
  hash: string,
): string {
  if (whereKind === 'json') {
    return `lower(hex(SHA256(toString(${columnName}))))='${hash}'`;
  }
  return `lower(hex(SHA256(leftUTF8(${columnName}, 1000))))='${hash}'`;
}

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

  it.each(Object.entries(SHA256_TEST_CASES))(
    'SHA256 row WHERE matches ClickHouse for %s',
    (_label, testCase) => {
      const columnName = testCase.columnMeta[0]!.name;

      const where = getRowWhere(
        { [columnName]: testCase.input },
        buildColumnMap(testCase.columnMeta, {}),
        {},
      ).where;

      expect(where).toBe(
        sha256RowWhere(columnName, testCase.whereKind, testCase.expected),
      );
    },
  );

  it('uses isNull for null JSON column values', () => {
    const meta: ColumnMetaType[] = [{ name: 'Body', type: 'JSON' }];

    const where = getRowWhere(
      { Body: null },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe('isNull(Body)');
  });

  it('uses isNull for null Date column values', () => {
    const meta: ColumnMetaType[] = [
      { name: 'event_created', type: "Nullable(DateTime64(3, 'UTC'))" },
    ];

    const where = getRowWhere(
      { event_created: null },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe('isNull(event_created)');
  });
});
