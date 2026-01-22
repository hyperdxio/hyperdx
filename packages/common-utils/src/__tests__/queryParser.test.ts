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
