import { describe, expect, it } from '@jest/globals';

import type { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';

import { buildColumnMap, getRowWhere } from '@/shared/useRowWhere';

/** From ClickHouse: lower(hex(SHA256(<json log line>))) on telemetry.otel_logs. */
const OTEL_LOG_JSON_FOR_SHA256 =
  '{"caller":"github.com/cloudzero/cloudzero-agent/app/domain/shipper/shipper.go:289","level":"info","message":"Successfully ran the shipper cycle","time":"2026-10-18T00:00:03Z","version":"5d05872b1f292e4bf481c61b187494b9bafff6a8.1.2.10-2026-03-24_02:00:46PM"}';

const OTEL_LOG_JSON_SHA256_HEX =
  '9bf1e18eb79cfe32fa7abb7c2b5370085a73eb299ffaaa526393084c8681c0b8';

/** From ClickHouse: lower(hex(SHA256(repeat('a', 600)))). */
const LONG_STRING_SHA256_HEX =
  'ba35c170729417f1499e0886e7e12fcdb4ab00ad411110ae1e888c766d4ed70d';

/** From ClickHouse: lower(hex(SHA256(leftUTF8(repeat('a', 2000), 1000)))). */
const LONGER_STRING_SHA256_HEX =
  '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3';

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

  it('hashes JSON columns with SHA256 (otel log payload)', () => {
    const meta: ColumnMetaType[] = [{ name: 'Body', type: 'JSON' }];

    const where = getRowWhere(
      { Body: OTEL_LOG_JSON_FOR_SHA256 },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe(
      `lower(hex(SHA256(toString(Body))))='${OTEL_LOG_JSON_SHA256_HEX}'`,
    );
  });

  it('hashes strings longer than MAX_STRING_LENGTH with SHA256', () => {
    const meta: ColumnMetaType[] = [{ name: 'description', type: 'String' }];

    const where = getRowWhere(
      { description: 'a'.repeat(600) },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe(
      `lower(hex(SHA256(leftUTF8(description, 1000))))='${LONG_STRING_SHA256_HEX}'`,
    );
  });

  it('hashes only the first 1000 UTF-8 code units when the string exceeds that limit', () => {
    const meta: ColumnMetaType[] = [{ name: 'description', type: 'String' }];

    const where = getRowWhere(
      { description: 'a'.repeat(2000) },
      buildColumnMap(meta, {}),
      {},
    ).where;

    expect(where).toBe(
      `lower(hex(SHA256(leftUTF8(description, 1000))))='${LONGER_STRING_SHA256_HEX}'`,
    );
  });
});
