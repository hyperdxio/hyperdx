import { ClickhouseClient } from '@/clickhouse/node';
import { getMetadata } from '@/core/metadata';
import {
  CustomSchemaSQLSerializerV2,
  genEnglishExplanation,
  SearchQueryBuilder,
} from '@/queryParser';

describe('CustomSchemaSQLSerializerV2 - json', () => {
  const metadata = getMetadata(
    new ClickhouseClient({ host: 'http://localhost:8123' }),
  );
  metadata.getColumn = jest.fn().mockImplementation(async ({ column }) => {
    if (column === 'ResourceAttributesJSON') {
      return { name: 'ResourceAttributesJSON', type: 'JSON' };
    } else if (column === 'LogAttributes') {
      return { name: 'LogAttributes', type: 'Map' };
    } else if (column === 'ServiceName') {
      return { name: 'ServiceName', type: 'String' };
    } else if (column === 'SeverityNumber') {
      return { name: 'SeverityNumber', type: 'UInt8' };
    } else if (column === 'foo') {
      return { name: 'foo', type: 'String' };
    } else {
      return undefined;
    }
  });
  const databaseName = 'testName';
  const tableName = 'testTable';
  const connectionId = 'testId';
  const serializer = new CustomSchemaSQLSerializerV2({
    metadata,
    databaseName,
    tableName,
    connectionId,
    implicitColumnExpression: 'Body',
  });

  it('getColumnForField', async () => {
    const field1 = 'ResourceAttributesJSON.test';
    const res1 = await serializer.getColumnForField(field1, {});
    expect(res1).toEqual({
      column: '',
      columnJSON: {
        number:
          "dynamicType(`ResourceAttributesJSON`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`test`",
        string: 'toString(`ResourceAttributesJSON`.`test`)',
      },
      found: true,
      propertyType: 'json',
    });
    const field2 = 'ResourceAttributesJSON.test.nest';
    const res2 = await serializer.getColumnForField(field2, {});
    expect(res2).toEqual({
      column: '',
      columnJSON: {
        number:
          "dynamicType(`ResourceAttributesJSON`.`test`.`nest`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`test`.`nest`",
        string: 'toString(`ResourceAttributesJSON`.`test`.`nest`)',
      },
      found: true,
      propertyType: 'json',
    });
  });

  it('compare - eq, isNotNull, gte, lte, lt, gt', async () => {
    const eqField = 'ResourceAttributesJSON.eq.test';
    const eqTerm = 'testTerm';
    const eq1 = await serializer.eq(eqField, eqTerm, false, {});
    expect(eq1).toBe(
      "(toString(`ResourceAttributesJSON`.`eq`.`test`) = 'testTerm')",
    );
    const eq2 = await serializer.eq(eqField, eqTerm, true, {});
    expect(eq2).toBe(
      "(toString(`ResourceAttributesJSON`.`eq`.`test`) != 'testTerm')",
    );
  });

  it('compare - isNotNull', async () => {
    const isNotNullField = 'ResourceAttributesJSON.isNotNull.test';
    const isNotNull1 = await serializer.isNotNull(isNotNullField, false, {});
    expect(isNotNull1).toBe(
      'notEmpty(toString(`ResourceAttributesJSON`.`isNotNull`.`test`)) = 1',
    );
    const isNotNull2 = await serializer.isNotNull(isNotNullField, true, {});
    expect(isNotNull2).toBe(
      'notEmpty(toString(`ResourceAttributesJSON`.`isNotNull`.`test`)) != 1',
    );
  });

  it('compare - gte', async () => {
    const gteField = 'ResourceAttributesJSON.gte.test';
    const gteTerm = '30';
    const gte = await serializer.gte(gteField, gteTerm, {});
    expect(gte).toBe(
      "(dynamicType(`ResourceAttributesJSON`.`gte`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`gte`.`test` >= '30')",
    );
  });

  it('compare - lte', async () => {
    const lteField = 'ResourceAttributesJSON.lte.test';
    const lteTerm = '40';
    const lte = await serializer.lte(lteField, lteTerm, {});
    expect(lte).toBe(
      "(dynamicType(`ResourceAttributesJSON`.`lte`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`lte`.`test` <= '40')",
    );
  });

  it('compare - gt', async () => {
    const gtField = 'ResourceAttributesJSON.gt.test';
    const gtTerm = '70';
    const gt = await serializer.gt(gtField, gtTerm, {});
    expect(gt).toBe(
      "(dynamicType(`ResourceAttributesJSON`.`gt`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`gt`.`test` > '70')",
    );
  });

  it('compare - lt', async () => {
    const ltField = 'ResourceAttributesJSON.lt.test';
    const ltTerm = '2';
    const lt = await serializer.lt(ltField, ltTerm, {});
    expect(lt).toBe(
      "(dynamicType(`ResourceAttributesJSON`.`lt`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`lt`.`test` < '2')",
    );
  });

  const testCases = [
    {
      lucene: '"foo bar baz"',
      sql: "((hasToken(lower(Body), lower('foo')) AND hasToken(lower(Body), lower('bar')) AND hasToken(lower(Body), lower('baz')) AND (lower(Body) LIKE lower('%foo bar baz%'))))",
      english: 'event has whole word "foo bar baz"',
    },
    {
      lucene: 'foo bar baz',
      sql: "((hasToken(lower(Body), lower('foo'))) AND (hasToken(lower(Body), lower('bar'))) AND (hasToken(lower(Body), lower('baz'))))",
      english:
        'event has whole word foo AND event has whole word bar AND event has whole word baz',
    },
    {
      lucene: 'ServiceName:foo bar baz',
      sql: "((ServiceName ILIKE '%foo%') AND (hasToken(lower(Body), lower('bar'))) AND (hasToken(lower(Body), lower('baz'))))",
      english:
        "'ServiceName' contains foo AND event has whole word bar AND event has whole word baz",
    },
    {
      lucene: 'ServiceName:"foo bar baz"',
      sql: "((ServiceName = 'foo bar baz'))",
      english: "'ServiceName' is foo bar baz",
    },
    {
      lucene: 'ServiceName:("foo bar baz")',
      sql: "(((ServiceName ILIKE '%foo bar baz%')))",
      english: '(ServiceName contains "foo bar baz")',
    },
    {
      lucene: 'ServiceName:(abc def)',
      sql: "(((ServiceName ILIKE '%abc%') AND (ServiceName ILIKE '%def%')))",
      english: '(ServiceName contains abc AND ServiceName contains def)',
    },
    {
      lucene: '(abc def)',
      sql: "(((hasToken(lower(Body), lower('abc'))) AND (hasToken(lower(Body), lower('def')))))",
      english: '(event has whole word abc AND event has whole word def)',
    },
    {
      lucene: '("abc def")',
      sql: "(((hasToken(lower(Body), lower('abc')) AND hasToken(lower(Body), lower('def')) AND (lower(Body) LIKE lower('%abc def%')))))",
      english: '(event has whole word "abc def")',
    },
    {
      lucene: 'foo:bar',
      sql: "((foo ILIKE '%bar%'))",
      english: "'foo' contains bar",
    },
    {
      lucene: '(foo:bar)',
      sql: "(((foo ILIKE '%bar%')))",
      english: "('foo' contains bar)",
    },
    {
      lucene: 'bar',
      sql: "((hasToken(lower(Body), lower('bar'))))",
      english: 'event has whole word bar',
    },
    {
      lucene: '(bar)',
      sql: "(((hasToken(lower(Body), lower('bar')))))",
      english: '(event has whole word bar)',
    },
    {
      lucene: 'foo:(bar)',
      sql: "(((foo ILIKE '%bar%')))",
      english: '(foo contains bar)',
    },
    {
      lucene: 'foo:(bar) baz',
      sql: "(((foo ILIKE '%bar%')) AND (hasToken(lower(Body), lower('baz'))))",
      english: '(foo contains bar) AND event has whole word baz',
    },
    {
      lucene: 'LogAttributes.error.message:("Failed to fetch")',
      sql: "(((`LogAttributes`['error.message'] ILIKE '%Failed to fetch%')))",
      english: '(LogAttributes.error.message contains "Failed to fetch")',
    },
    {
      lucene: 'ResourceAttributesJSON.error.message:("Failed to fetch")',
      sql: "(((toString(`ResourceAttributesJSON`.`error`.`message`) ILIKE '%Failed to fetch%')))",
      english:
        '(ResourceAttributesJSON.error.message contains "Failed to fetch")',
    },
    {
      lucene: 'SeverityNumber:>10',
      sql: "((SeverityNumber > '10'))",
      english: "'SeverityNumber' is greater than 10",
    },
    {
      lucene: 'ResourceAttributesJSON.error.severity:>10',
      sql: "((dynamicType(`ResourceAttributesJSON`.`error`.`severity`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `ResourceAttributesJSON`.`error`.`severity` > '10'))",
      english: "'ResourceAttributesJSON.error.severity' is greater than 10",
    },
    {
      lucene: 'foo:(bar baz)',
      sql: "(((foo ILIKE '%bar%') AND (foo ILIKE '%baz%')))",
      english: '(foo contains bar AND foo contains baz)',
    },
    {
      lucene: '-foo:bar',
      sql: "((foo NOT ILIKE '%bar%'))",
      english: "'foo' does not contain bar",
    },
    {
      lucene: 'NOT foo:(bar baz)',
      sql: "(NOT ((foo ILIKE '%bar%') AND (foo ILIKE '%baz%')))",
      english: 'NOT (foo contains bar AND foo contains baz)',
    },
    {
      lucene: '-foo:(bar baz)',
      sql: "(NOT ((foo ILIKE '%bar%') AND (foo ILIKE '%baz%')))",
      english: 'NOT (foo contains bar AND foo contains baz)',
    },
    {
      lucene: '-foo:(bar)',
      sql: "(NOT ((foo ILIKE '%bar%')))",
      english: 'NOT (foo contains bar)',
    },
    {
      lucene: '-foo:(-bar)',
      sql: "(NOT ((foo NOT ILIKE '%bar%')))",
      english: 'NOT (foo does not contain bar)',
    },
    {
      lucene: '*bar',
      sql: "((lower(Body) LIKE lower('%bar')))",
      english: 'event ends with bar',
    },
    {
      lucene: 'foo:*bar',
      sql: "((foo ILIKE '%bar%'))",
      english: "'foo' contains bar",
    },
    {
      lucene: 'foo:*bar*',
      sql: "((foo ILIKE '%bar%'))",
      english: "'foo' contains bar",
    },
    {
      lucene: 'foo:(*bar)',
      sql: "(((lower(foo) LIKE lower('%bar'))))",
      english: '(foo ends with bar)',
    },
    {
      lucene: 'foo:(bar*)',
      sql: "(((lower(foo) LIKE lower('bar%'))))",
      english: '(foo starts with bar)',
    },
    {
      lucene: 'foo:(*bar*)',
      sql: "(((lower(foo) LIKE lower('%bar%'))))",
      english: '(foo contains bar)',
    },
    {
      lucene: 'foo:[1 TO 5]',
      sql: '((foo BETWEEN 1 AND 5))',
      english: 'foo is between 1 and 5',
    },
    {
      lucene: 'foo:(bar:(baz) qux)',
      sql: "((((bar ILIKE '%baz%')) AND (foo ILIKE '%qux%')))",
      english: '((bar contains baz) AND foo contains qux)',
    },
  ];

  it.each(testCases)(
    'converts "$lucene" to SQL "$sql"',
    async ({ lucene, sql }) => {
      const builder = new SearchQueryBuilder(lucene, serializer);
      const actualSql = await builder.build();
      expect(actualSql).toBe(sql);
    },
  );

  it.each(testCases)(
    'converts "$lucene" to english "$english"',
    async ({ lucene, english }) => {
      const actualEnglish = await genEnglishExplanation(lucene);
      expect(actualEnglish).toBe(english);
    },
  );

  it('correctly searches multi-column implicit field', async () => {
    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body, OtherColumn',
    });

    const lucene = 'foo bar';
    const builder = new SearchQueryBuilder(lucene, serializer);
    const actualSql = await builder.build();
    const expectedSql =
      "((hasToken(lower(concatWithSeparator(';',Body,OtherColumn)), lower('foo'))) AND (hasToken(lower(concatWithSeparator(';',Body,OtherColumn)), lower('bar'))))";
    expect(actualSql).toBe(expectedSql);
  });
});
