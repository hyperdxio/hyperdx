import { JSDataType } from '@/clickhouse';
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
    } else if (column === 'MaterializedExample') {
      return { name: 'MaterializedExample', type: 'String' };
    } else {
      return undefined;
    }
  });
  metadata.getMaterializedColumnsLookupTable = jest
    .fn()
    .mockImplementation(async () => {
      return new Map([
        ["LogAttributes['materialized.example']", 'MaterializedExample'],
      ]);
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
      isArray: false,
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
      isArray: false,
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
      sql: "(((`LogAttributes`['error.message'] ILIKE '%Failed to fetch%' AND indexHint(mapContains(`LogAttributes`, 'error.message')))))",
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
    // indexHint related cases
    {
      // We can probably trust CH to use the map keys index, but let's be explicit anyways
      lucene: 'LogAttributes.error.message:"Failed to fetch"',
      sql: "((`LogAttributes`['error.message'] = 'Failed to fetch' AND indexHint(mapContains(`LogAttributes`, 'error.message'))))",
      english: "'LogAttributes.error.message' is Failed to fetch",
    },
    {
      // Can't really use the map keys index
      lucene: '-LogAttributes.error.message:"Failed to fetch"',
      sql: "((`LogAttributes`['error.message'] != 'Failed to fetch'))",
      english: "'LogAttributes.error.message' is not Failed to fetch",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.error.message:Failed',
      sql: "((`LogAttributes`['error.message'] ILIKE '%Failed%' AND indexHint(mapContains(`LogAttributes`, 'error.message'))))",
      english: "'LogAttributes.error.message' contains Failed",
    },
    {
      // Can't really use the map keys index
      lucene: '-LogAttributes.error.message:Failed',
      sql: "((`LogAttributes`['error.message'] NOT ILIKE '%Failed%'))",
      english: "'LogAttributes.error.message' does not contain Failed",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.error.message:*',
      sql: "(notEmpty(`LogAttributes`['error.message']) = 1 AND indexHint(mapContains(`LogAttributes`, 'error.message')))",
      english: "'LogAttributes.error.message' is not null",
    },
    {
      // Can't really use the map keys index
      lucene: '-LogAttributes.error.message:*',
      sql: "(notEmpty(`LogAttributes`['error.message']) != 1)",
      english: "'LogAttributes.error.message' is null",
    },
    {
      // Explicitly hint to CH to use the map keys index for the non-materialized entry
      lucene: 'MaterializedExample:"foo"',
      sql: "((MaterializedExample = 'foo' AND indexHint(mapContains(`LogAttributes`, 'materialized.example'))))",
      english: "'MaterializedExample' is foo",
    },
    {
      // Can't really use the map keys index
      lucene: '-MaterializedExample:"foo"',
      sql: "((MaterializedExample != 'foo'))",
      english: "'MaterializedExample' is not foo",
    },
    {
      // Explicitly hint to CH to use the map keys index for the non-materialized entry
      lucene: 'MaterializedExample:foo',
      sql: "((MaterializedExample ILIKE '%foo%' AND indexHint(mapContains(`LogAttributes`, 'materialized.example'))))",
      english: "'MaterializedExample' contains foo",
    },
    {
      // Can't really use the map keys index
      lucene: '-MaterializedExample:foo',
      sql: "((MaterializedExample NOT ILIKE '%foo%'))",
      english: "'MaterializedExample' does not contain foo",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.materialized.example:foo',
      sql: "((`LogAttributes`['materialized.example'] ILIKE '%foo%' AND indexHint(mapContains(`LogAttributes`, 'materialized.example'))))",
      english: "'LogAttributes.materialized.example' contains foo",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.example.number:>1',
      sql: "((`LogAttributes`['example.number'] > '1' AND indexHint(mapContains(`LogAttributes`, 'example.number'))))",
      english: "'LogAttributes.example.number' is greater than 1",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.example.number:>=1',
      sql: "((`LogAttributes`['example.number'] >= '1' AND indexHint(mapContains(`LogAttributes`, 'example.number'))))",
      english: "'LogAttributes.example.number' is greater than or equal to 1",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.example.number:<1',
      sql: "((`LogAttributes`['example.number'] < '1' AND indexHint(mapContains(`LogAttributes`, 'example.number'))))",
      english: "'LogAttributes.example.number' is less than 1",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.example.number:<=1',
      sql: "((`LogAttributes`['example.number'] <= '1' AND indexHint(mapContains(`LogAttributes`, 'example.number'))))",
      english: "'LogAttributes.example.number' is less than or equal to 1",
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.example.number:[1 TO 5]',
      sql: "((`LogAttributes`['example.number'] BETWEEN 1 AND 5 AND indexHint(mapContains(`LogAttributes`, 'example.number'))))",
      english: 'LogAttributes.example.number is between 1 and 5',
    },
    {
      // Can't really use the map keys index
      lucene: '-LogAttributes.example.number:[1 TO 5]',
      sql: "((`LogAttributes`['example.number'] NOT BETWEEN 1 AND 5))",
      english: 'LogAttributes.example.number is not between 1 and 5',
    },
    {
      // Explicitly hint to CH to use the map keys index
      lucene: 'LogAttributes.error.message:("A B")',
      sql: "(((`LogAttributes`['error.message'] ILIKE '%A B%' AND indexHint(mapContains(`LogAttributes`, 'error.message')))))",
      english: '(LogAttributes.error.message contains "A B")',
    },
    {
      // Can't really use the index here
      lucene: '-LogAttributes.error.message:("A B")',
      sql: "(NOT ((`LogAttributes`['error.message'] ILIKE '%A B%')))",
      english: 'NOT (LogAttributes.error.message contains "A B")',
    },
    // HDX-2655: Proper handling of binary expression with leading negation
    {
      lucene: 'NOT ServiceName:foo AND NOT ServiceName:bar',
      sql: "(NOT (ServiceName ILIKE '%foo%') AND NOT (ServiceName ILIKE '%bar%'))",
      english:
        "NOT 'ServiceName' contains foo AND NOT 'ServiceName' contains bar",
    },
    {
      lucene: 'NOT red AND NOT blue',
      sql: "(NOT (hasToken(lower(Body), lower('red'))) AND NOT (hasToken(lower(Body), lower('blue'))))",
      english: 'NOT event has whole word red AND NOT event has whole word blue',
    },
    {
      lucene: 'NOT red OR NOT blue',
      sql: "(NOT (hasToken(lower(Body), lower('red'))) OR NOT (hasToken(lower(Body), lower('blue'))))",
      english: 'NOT event has whole word red OR NOT event has whole word blue',
    },
    {
      lucene: 'NOT red NOT blue',
      sql: "(NOT (hasToken(lower(Body), lower('red'))) AND NOT (hasToken(lower(Body), lower('blue'))))",
      english: 'NOT event has whole word red AND NOT event has whole word blue',
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
      const actualEnglish = await genEnglishExplanation({
        query: lucene,
        tableConnection: {
          tableName,
          databaseName,
          connectionId,
        },
        metadata,
      });
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

describe('CustomSchemaSQLSerializerV2 - bloom_filter tokens() indices', () => {
  const metadata = getMetadata(
    new ClickhouseClient({ host: 'http://localhost:8123' }),
  );

  const databaseName = 'default';
  const tableName = 'otel_logs';
  const connectionId = 'test';

  beforeEach(() => {
    // Mock getColumn to return Body as String column
    metadata.getColumn = jest.fn().mockImplementation(async ({ column }) => {
      if (column === 'Body') {
        return { name: 'Body', type: 'String' };
      } else if (column === 'ServiceName') {
        return { name: 'ServiceName', type: 'String' };
      }
      return undefined;
    });
  });

  it('should use hasAll when bloom_filter tokens() index exists', async () => {
    // Mock getSkipIndices to return bloom_filter with tokens(lower(Body))
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(lower(Body))',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    expect(sql).toBe("((hasAll(tokens(lower(Body)), tokens(lower('foo')))))");
  });

  it('should use hasAll for multi-token terms with single call', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(lower(Body))',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('"foo bar"', serializer);
    const sql = await builder.build();

    expect(sql).toContain(
      "hasAll(tokens(lower(Body)), tokens(lower('foo bar')))",
    );
    expect(sql).toContain("(lower(Body) LIKE lower('%foo bar%'))");
  });

  it('should fallback to hasToken when no bloom_filter tokens() index found', async () => {
    // Mock getSkipIndices to return empty
    metadata.getSkipIndices = jest.fn().mockResolvedValue([]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should use hasToken (existing behavior)
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should handle bloom_filter without tokens() expression', async () => {
    // Mock index with type=bloom_filter but expression='TraceId' (not tokens)
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_trace_id',
        type: 'bloom_filter',
        expression: 'TraceId',
        granularity: '1',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should fallback to hasToken (index doesn't use tokens())
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should ignore tokenbf_v1 indices and use hasToken', async () => {
    // Mock getSkipIndices to return tokenbf_v1 (should be ignored)
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_lower_body',
        type: 'tokenbf_v1',
        expression: 'lower(Body)',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should fallback to hasToken (tokenbf_v1 is ignored by findBloomFilterTokensIndex)
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should handle negated searches with hasAll', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(lower(Body))',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('-foo', serializer);
    const sql = await builder.build();

    // Should use NOT hasAll
    expect(sql).toBe(
      "((NOT hasAll(tokens(lower(Body)), tokens(lower('foo')))))",
    );
  });

  it('should not use bloom_filter index for explicit field searches', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(lower(Body))',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    // Query: 'ServiceName:foo'
    const builder = new SearchQueryBuilder('ServiceName:foo', serializer);
    const sql = await builder.build();

    // Should use ILIKE, not hasAll or hasToken
    expect(sql).toContain('ILIKE');
    expect(sql).not.toContain('hasAll');
    expect(sql).not.toContain('hasToken');
  });

  it('should match index expression with different whitespace', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(lower( Body ))', // Extra whitespace
        granularity: 8,
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should match and use hasAll (columnsMatch normalizes whitespace)
    expect(sql).toBe("((hasAll(tokens(lower( Body )), tokens(lower('foo')))))");
  });

  it('should use hasAll for multiple separate terms', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(lower(Body))',
        granularity: 8,
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo bar baz', serializer);
    const sql = await builder.build();

    // Should generate separate hasAll for each term (not single statement)
    expect(sql).toContain("hasAll(tokens(lower(Body)), tokens(lower('foo')))");
    expect(sql).toContain("hasAll(tokens(lower(Body)), tokens(lower('bar')))");
    expect(sql).toContain("hasAll(tokens(lower(Body)), tokens(lower('baz')))");
  });

  it('should not apply lower() to the search term if the index expression includes lower with extra whitespace', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens ( lower ( Body ) ) ',
        granularity: 8,
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('FooBar', serializer);
    const sql = await builder.build();

    // Should apply lower() to search term
    expect(sql).toBe(
      "((hasAll(tokens ( lower ( Body ) ) , tokens(lower('FooBar')))))",
    );

    const builder2 = new SearchQueryBuilder('"Foo Bar"', serializer);
    const sql2 = await builder2.build();

    expect(sql2).toBe(
      "((hasAll(tokens ( lower ( Body ) ) , tokens(lower('Foo Bar'))) AND (lower(Body) LIKE lower('%Foo Bar%'))))",
    );
  });

  it('should not apply lower() to the search term if the index expression does not have lower()', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_tokens',
        type: 'bloom_filter',
        expression: 'tokens(Body)', // No lower()
        granularity: 8,
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('FooBar', serializer);
    const sql = await builder.build();

    // Should not apply lower() to search term
    expect(sql).toBe("((hasAll(tokens(Body), tokens('FooBar'))))");

    const builder2 = new SearchQueryBuilder('"Foo Bar"', serializer);
    const sql2 = await builder2.build();

    expect(sql2).toBe(
      "((hasAll(tokens(Body), tokens('Foo Bar')) AND (lower(Body) LIKE lower('%Foo Bar%'))))",
    );
  });
});

describe('CustomSchemaSQLSerializerV2 - text indices', () => {
  const metadata = getMetadata(
    new ClickhouseClient({ host: 'http://localhost:8123' }),
  );

  const databaseName = 'default';
  const tableName = 'otel_logs';
  const connectionId = 'test';

  beforeEach(() => {
    // Mock getColumn to return Body as String column
    metadata.getColumn = jest.fn().mockImplementation(async ({ column }) => {
      if (column === 'Body') {
        return { name: 'Body', type: 'String' };
      } else if (column === 'ServiceName') {
        return { name: 'ServiceName', type: 'String' };
      }
      return undefined;
    });

    metadata.getSetting = jest
      .fn()
      .mockImplementation(async ({ settingName }) => {
        if (settingName === 'enable_full_text_index') {
          return '1';
        }
        return undefined;
      });
  });

  it('should use hasAllTokens when text index exists', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    expect(sql).toBe("((hasAllTokens(Body, 'foo')))");
  });

  it('should use hasAllTokens for multi-token terms with single call', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha, preprocessor=lower(Body))',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('"foo bar"', serializer);
    const sql = await builder.build();

    expect(sql).toContain("hasAllTokens(Body, 'foo bar')");
    expect(sql).toContain("(lower(Body) LIKE lower('%foo bar%'))");
  });

  it('should fallback to hasToken when no text indexes are found', async () => {
    // Mock getSkipIndices to return empty
    metadata.getSkipIndices = jest.fn().mockResolvedValue([]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should use hasToken (existing behavior)
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should handle text index on a different column', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'OtherBody',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should fallback to hasToken (index doesn't use tokens())
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should handle negated searches with hasAllTokens', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha, preprocessor=lower(Body))',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('-foo', serializer);
    const sql = await builder.build();

    // Should use NOT hasAllTokens
    expect(sql).toBe("((NOT hasAllTokens(Body, 'foo')))");
  });

  it('should not use text index for explicit field searches', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    // Query: 'ServiceName:foo'
    const builder = new SearchQueryBuilder('ServiceName:foo', serializer);
    const sql = await builder.build();

    // Should use ILIKE, not hasAll or hasToken
    expect(sql).toContain('ILIKE');
    expect(sql).not.toContain('hasAll');
    expect(sql).not.toContain('hasToken');
  });

  it('should batch tokens into groups to avoid hitting the hasAllTokens limit', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder(
      '"1 2 3 4 5 6 7 8 9 10; 11 12 13 14 15 16 17 18 19 20; 21 22 23 24 25 26 27 28 29 30; 31 32 33 34 35 36 37 38 39 40; 41 42 43 44 45 46 47 48 49 50; 51 52 53 54 55 56 57 58 59 60;"',
      serializer,
    );
    const sql = await builder.build();

    // Should generate separate hasAllTokens for each term (not single statement)
    expect(sql).toContain(
      "hasAllTokens(Body, '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50') AND hasAllTokens(Body, '51 52 53 54 55 56 57 58 59 60') AND (lower(Body) LIKE lower('%1 2 3 4 5 6 7 8 9 10; 11 12 13 14 15 16 17 18 19 20; 21 22 23 24 25 26 27 28 29 30; 31 32 33 34 35 36 37 38 39 40; 41 42 43 44 45 46 47 48 49 50; 51 52 53 54 55 56 57 58 59 60;%'))",
    );
  });

  it('should use hasAllTokens for multiple separate terms', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo NOT bar baz', serializer);
    const sql = await builder.build();

    // Should generate separate hasAllTokens for each term (not single statement)
    expect(sql).toContain("hasAllTokens(Body, 'foo')");
    expect(sql).toContain("NOT (hasAllTokens(Body, 'bar'))");
    expect(sql).toContain("hasAllTokens(Body, 'baz')");
  });

  it('should not use text index when enable_full_text_index is disabled', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    // Mock getSetting to disable full text index
    metadata.getSetting = jest
      .fn()
      .mockImplementation(async ({ settingName }) => {
        if (settingName === 'enable_full_text_index') {
          return '0';
        }
        return undefined;
      });

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should fallback to hasToken (full text index disabled)
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should not use text index when enable_full_text_index is unavailable (ClickHouse version is old)', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    // Mock getSetting to disable full text index
    metadata.getSetting = jest.fn().mockResolvedValue(undefined);

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should fallback to hasToken (full text index disabled)
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });

  it('should not use text index when getSetting throws an error', async () => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_body_text',
        type: 'text',
        typeFull: 'text(tokenizer=splitByNonAlpha)',
        expression: 'Body',
        granularity: '8',
      },
    ]);

    // Mock getSetting to disable full text index
    metadata.getSetting = jest
      .fn()
      .mockRejectedValue(new Error('Failed to get setting'));

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName,
      tableName,
      connectionId,
      implicitColumnExpression: 'Body',
    });

    const builder = new SearchQueryBuilder('foo', serializer);
    const sql = await builder.build();

    // Should fallback to hasToken (full text index disabled)
    expect(sql).toBe("((hasToken(lower(Body), lower('foo'))))");
  });
});

describe('CustomSchemaSQLSerializerV2 - indexCoversColumn', () => {
  const metadata = getMetadata(
    new ClickhouseClient({ host: 'http://localhost:8123' }),
  );

  const databaseName = 'default';
  const tableName = 'otel_logs';
  const connectionId = 'test';

  beforeEach(() => {
    metadata.getSkipIndices = jest.fn().mockResolvedValue([]);
  });

  it.each([
    {
      indexExpression: 'Body',
      searchExpression: 'Body',
      expected: true,
    },
    {
      indexExpression: 'tokens(Body)',
      searchExpression: 'Body',
      expected: true,
    },
    // Test cases for quoted identifiers
    {
      indexExpression: 'tokens(`Body`)',
      searchExpression: 'Body',
      expected: true,
    },
    {
      indexExpression: 'tokens(Body)',
      searchExpression: '`Body`',
      expected: true,
    },
    // Test case for case sensitivity
    {
      indexExpression: 'tokens(body)',
      searchExpression: 'Body',
      expected: false,
    },
    // Test case for whitespace variations
    {
      indexExpression: 'tokens( lower( Body ) )',
      searchExpression: 'Body',
      expected: true,
    },
    // Test case for column with underscore
    {
      indexExpression: 'tokens(lower(fancy_Body))',
      searchExpression: 'fancy_Body',
      expected: true,
    },
    // Test cases for concatWithSeparator
    {
      indexExpression: "tokens(concatWithSeparator(';',Body,Message))",
      searchExpression: 'Body',
      expected: true,
    },
    // Test case where column is substring or superstring of the indexed column
    {
      indexExpression: "tokens(concatWithSeparator(';',Body2,Message))",
      searchExpression: 'Body',
      expected: false,
    },
    {
      indexExpression: "tokens(concatWithSeparator(';',Body,Message))",
      searchExpression: 'Body2',
      expected: false,
    },
  ])(
    'should return $expected for indexExpression: "$indexExpression" and searchExpression: "$searchExpression"',
    async ({ indexExpression, searchExpression, expected }) => {
      const serializer = new CustomSchemaSQLSerializerV2({
        metadata,
        databaseName,
        tableName,
        connectionId,
        implicitColumnExpression: 'Body',
      });

      expect(
        serializer.indexCoversColumn(indexExpression, searchExpression),
      ).toBe(expected);
    },
  );
});

describe('CustomSchemaSQLSerializerV2 - Array and Nested Fields', () => {
  const metadata = getMetadata(
    new ClickhouseClient({ host: 'http://localhost:8123' }),
  );
  metadata.getColumn = jest.fn().mockImplementation(async ({ column }) => {
    if (column === 'Events.Name') {
      return { name: 'Events.Name', type: 'Array(String)' };
    } else if (column === 'Events.Count') {
      return { name: 'Events.Count', type: 'Array(UInt64)' };
    } else if (column === 'Events.Attributes') {
      return { name: 'Events.Attributes', type: 'Array(Map(String, String))' };
    } else if (column === 'Events.IsAvailable') {
      return { name: 'Events.IsAvailable', type: 'Array(Bool)' };
    } else if (column === 'Events.Timestamp') {
      return { name: 'Events.Timestamp', type: 'Array(DateTime64)' };
    } else if (column === 'Events.JSONAttributes') {
      return { name: 'Events.JSONAttributes', type: 'Array(JSON)' };
    } else {
      return undefined;
    }
  });
  metadata.getMaterializedColumnsLookupTable = jest
    .fn()
    .mockResolvedValue(new Map());
  metadata.getSetting = jest.fn().mockResolvedValue(undefined);
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
    const field1 = 'Events.Name';
    const res1 = await serializer.getColumnForField(field1, {});
    expect(res1).toEqual({
      column: 'Events.Name',
      found: true,
      propertyType: JSDataType.String,
      isArray: true,
    });

    const field2 = 'Events.Count';
    const res2 = await serializer.getColumnForField(field2, {});
    expect(res2).toEqual({
      column: 'Events.Count',
      found: true,
      propertyType: JSDataType.Number,
      isArray: true,
    });

    const field3 = 'Events.IsAvailable';
    const res3 = await serializer.getColumnForField(field3, {});
    expect(res3).toEqual({
      column: 'Events.IsAvailable',
      found: true,
      propertyType: JSDataType.Bool,
      isArray: true,
    });
  });

  it('compare - eq', async () => {
    const eqField = 'Events.Name';
    const eqTerm = 'error';

    const eq1 = await serializer.eq(eqField, eqTerm, false, {});
    expect(eq1).toBe("has(Events.Name, 'error')");

    const eq2 = await serializer.eq(eqField, eqTerm, true, {});
    expect(eq2).toBe("NOT has(Events.Name, 'error')");
  });

  it('compare - isNotNull', async () => {
    const isNotNullField = 'Events.Name';

    const isNotNull1 = await serializer.isNotNull(isNotNullField, false, {});
    expect(isNotNull1).toBe('notEmpty(Events.Name) = 1');

    const isNotNull2 = await serializer.isNotNull(isNotNullField, true, {});
    expect(isNotNull2).toBe('notEmpty(Events.Name) != 1');
  });

  it('compare - gte', async () => {
    const gteField = 'Events.Name';
    const gteTerm = '30';
    await expect(async () =>
      serializer.gte(gteField, gteTerm, {}),
    ).rejects.toThrow('>= comparison is not supported for Array-type fields');
  });

  it('compare - lte', async () => {
    const lteField = 'Events.Name';
    const lteTerm = '40';
    await expect(async () =>
      serializer.lte(lteField, lteTerm, {}),
    ).rejects.toThrow('<= comparison is not supported for Array-type fields');
  });

  it('compare - gt', async () => {
    const gtField = 'Events.Name';
    const gtTerm = '70';
    await expect(async () =>
      serializer.gt(gtField, gtTerm, {}),
    ).rejects.toThrow('> comparison is not supported for Array-type fields');
  });

  it('compare - lt', async () => {
    const ltField = 'Events.Name';
    const ltTerm = '2';
    await expect(async () =>
      serializer.lt(ltField, ltTerm, {}),
    ).rejects.toThrow('< comparison is not supported for Array-type fields');
  });

  it('compare - range', async () => {
    const rangeField = 'Events.Name';
    await expect(async () =>
      serializer.range(rangeField, '2', '5', false, {}),
    ).rejects.toThrow(
      'range comparison is not supported for Array-type fields',
    );
  });

  const testCases = [
    // String array field tests
    {
      lucene: 'Events.Name:foo',
      sql: "(arrayExists(el -> el ILIKE '%foo%', Events.Name))",
      english: "'Events.Name' contains an element containing foo",
    },
    {
      lucene: 'NOT Events.Name:foo',
      sql: "(NOT arrayExists(el -> el ILIKE '%foo%', Events.Name))",
      english: "NOT 'Events.Name' contains an element containing foo",
    },
    {
      lucene: '-Events.Name:foo',
      sql: "(NOT arrayExists(el -> el ILIKE '%foo%', Events.Name))",
      english: "'Events.Name' does not contain an element containing foo",
    },
    {
      lucene: 'Events.Name:"foo"',
      sql: "(has(Events.Name, 'foo'))",
      english: "'Events.Name' contains foo",
    },
    {
      lucene: 'NOT Events.Name:"foo"',
      sql: "(NOT has(Events.Name, 'foo'))",
      english: "NOT 'Events.Name' contains foo",
    },
    {
      lucene: '-Events.Name:"foo"',
      sql: "(NOT has(Events.Name, 'foo'))",
      english: "'Events.Name' does not contain foo",
    },
    {
      lucene: 'Events.Name:"foo bar"',
      sql: "(has(Events.Name, 'foo bar'))",
      english: "'Events.Name' contains foo bar",
    },
    {
      lucene: 'NOT Events.Name:"foo bar"',
      sql: "(NOT has(Events.Name, 'foo bar'))",
      english: "NOT 'Events.Name' contains foo bar",
    },
    {
      lucene: '-Events.Name:"foo bar"',
      sql: "(NOT has(Events.Name, 'foo bar'))",
      english: "'Events.Name' does not contain foo bar",
    },
    // Prefix / suffix wildcard tests
    {
      lucene: 'Events.Name:foo*',
      sql: "(arrayExists(el -> el ILIKE '%foo%', Events.Name))",
      english: "'Events.Name' contains an element containing foo",
    },
    {
      lucene: 'Events.Name:*foo',
      sql: "(arrayExists(el -> el ILIKE '%foo%', Events.Name))",
      english: "'Events.Name' contains an element containing foo",
    },
    {
      lucene: 'Events.Name:*foo*',
      sql: "(arrayExists(el -> el ILIKE '%foo%', Events.Name))",
      english: "'Events.Name' contains an element containing foo",
    },
    // Number array field tests
    {
      lucene: 'Events.Count:5',
      sql: "(has(Events.Count, CAST('5', 'Float64')))",
      english: "'Events.Count' contains 5",
    },
    {
      lucene: 'NOT Events.Count:5',
      sql: "(NOT has(Events.Count, CAST('5', 'Float64')))",
      english: "NOT 'Events.Count' contains 5",
    },
    {
      lucene: 'Events.Count:"4"',
      sql: "(has(Events.Count, CAST('4', 'Float64')))",
      english: "'Events.Count' contains 4",
    },
    {
      lucene: 'NOT Events.Count:"4"',
      sql: "(NOT has(Events.Count, CAST('4', 'Float64')))",
      english: "NOT 'Events.Count' contains 4",
    },
    // Boolean array field tests
    {
      lucene: 'Events.IsAvailable:true',
      sql: '(has(Events.IsAvailable, 1))',
      english: "'Events.IsAvailable' contains true",
    },
    {
      lucene: 'NOT Events.IsAvailable:true',
      sql: '(NOT has(Events.IsAvailable, 1))',
      english: "NOT 'Events.IsAvailable' contains true",
    },
    {
      lucene: 'Events.IsAvailable:false',
      sql: '(has(Events.IsAvailable, 0))',
      english: "'Events.IsAvailable' contains false",
    },
    {
      lucene: 'NOT Events.IsAvailable:false',
      sql: '(NOT has(Events.IsAvailable, 0))',
      english: "NOT 'Events.IsAvailable' contains false",
    },
    // Array(Map(String, String)) tests
    {
      lucene: 'Events.Attributes.message:key1',
      sql: "(arrayExists(el -> el['message'] ILIKE '%key1%', Events.Attributes))",
      english:
        "'Events.Attributes' contains an element with key message and value key1",
    },
    {
      lucene: '-Events.Attributes.message:key1',
      sql: "(NOT arrayExists(el -> el['message'] ILIKE '%key1%', Events.Attributes))",
      english:
        "'Events.Attributes' does not contain an element with key message and value key1",
    },
    {
      lucene: 'Events.Attributes.message:key1*',
      sql: "(arrayExists(el -> el['message'] ILIKE '%key1%', Events.Attributes))",
      english:
        "'Events.Attributes' contains an element with key message and value key1",
    },
    {
      lucene: 'Events.Attributes.message:"key1"',
      sql: "(arrayExists(el -> el['message'] = 'key1', Events.Attributes))",
      english: "'Events.Attributes.message' contains key1",
    },
    {
      lucene: 'Events.Attributes.message.subkey:"key1"',
      sql: "(arrayExists(el -> el['message.subkey'] = 'key1', Events.Attributes))",
      english: "'Events.Attributes.message.subkey' contains key1",
    },
    {
      lucene: 'Events.Attributes.message:("key1 key2")',
      sql: "((arrayExists(el -> el['message'] ILIKE '%key1 key2%', Events.Attributes)))",
      english: '(Events.Attributes.message contains "key1 key2")',
    },
    {
      lucene: 'Events.Attributes.message:*',
      sql: "(arrayExists(el -> notEmpty(toString(el['message'])) = 1, Events.Attributes))",
      english: "'Events.Attributes' contains an element with non-null message",
    },
    {
      lucene: '-Events.Attributes.message:*',
      sql: "(NOT arrayExists(el -> notEmpty(toString(el['message'])) = 1, Events.Attributes))",
      english:
        "'Events.Attributes' does not contain an element with non-null message",
    },
    {
      lucene: 'NOT Events.Attributes.message:*',
      sql: "(NOT arrayExists(el -> notEmpty(toString(el['message'])) = 1, Events.Attributes))",
      english:
        "NOT 'Events.Attributes' contains an element with non-null message",
    },
    {
      lucene: 'Events.Attributes:*',
      sql: '(notEmpty(Events.Attributes) = 1)',
      english: "'Events.Attributes' is not null",
    },
    // Non-string inner type tests
    {
      lucene: 'Events.Timestamp:"2025-01-01"',
      sql: "(arrayExists(el -> toString(el) = '2025-01-01', Events.Timestamp))",
      english: "'Events.Timestamp' contains 2025-01-01",
    },
    {
      lucene: 'Events.Timestamp:2025-01-01',
      sql: "(arrayExists(el -> toString(el) ILIKE '%2025-01-01%', Events.Timestamp))",
      english: "'Events.Timestamp' contains an element containing 2025-01-01",
    },
    // JSON inner type tests
    {
      lucene: 'Events.JSONAttributes.message:key1',
      sql: "(arrayExists(el -> toString(el.`message`) ILIKE '%key1%', Events.JSONAttributes))",
      english:
        "'Events.JSONAttributes' contains an element with key message and value key1",
    },
    {
      lucene: '-Events.JSONAttributes.message:key1',
      sql: "(NOT arrayExists(el -> toString(el.`message`) ILIKE '%key1%', Events.JSONAttributes))",
      english:
        "'Events.JSONAttributes' does not contain an element with key message and value key1",
    },
    {
      lucene: 'Events.JSONAttributes.message:key1*',
      sql: "(arrayExists(el -> toString(el.`message`) ILIKE '%key1%', Events.JSONAttributes))",
      english:
        "'Events.JSONAttributes' contains an element with key message and value key1",
    },
    {
      lucene: 'Events.JSONAttributes.message:"key1"',
      sql: "(arrayExists(el -> toString(el.`message`) = 'key1', Events.JSONAttributes))",
      english: "'Events.JSONAttributes.message' contains key1",
    },
    {
      lucene: 'Events.JSONAttributes.message.subkey:"key1"',
      sql: "(arrayExists(el -> toString(el.`message`.`subkey`) = 'key1', Events.JSONAttributes))",
      english: "'Events.JSONAttributes.message.subkey' contains key1",
    },
    {
      lucene: 'Events.JSONAttributes.message:("key1 key2")',
      sql: "((arrayExists(el -> toString(el.`message`) ILIKE '%key1 key2%', Events.JSONAttributes)))",
      english: '(Events.JSONAttributes.message contains "key1 key2")',
    },
    {
      lucene: 'Events.JSONAttributes.message:*',
      sql: '(arrayExists(el -> notEmpty(toString(el.`message`)) = 1, Events.JSONAttributes))',
      english:
        "'Events.JSONAttributes' contains an element with non-null message",
    },
    {
      lucene: '-Events.JSONAttributes.message:*',
      sql: '(NOT arrayExists(el -> notEmpty(toString(el.`message`)) = 1, Events.JSONAttributes))',
      english:
        "'Events.JSONAttributes' does not contain an element with non-null message",
    },
    {
      lucene: 'NOT Events.JSONAttributes.message:*',
      sql: '(NOT arrayExists(el -> notEmpty(toString(el.`message`)) = 1, Events.JSONAttributes))',
      english:
        "NOT 'Events.JSONAttributes' contains an element with non-null message",
    },
    {
      lucene: 'Events.JSONAttributes:*',
      sql: '(notEmpty(Events.JSONAttributes) = 1)',
      english: "'Events.JSONAttributes' is not null",
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
      const actualEnglish = await genEnglishExplanation({
        query: lucene,
        tableConnection: {
          tableName,
          databaseName,
          connectionId,
        },
        metadata,
      });
      expect(actualEnglish).toBe(english);
    },
  );
});
