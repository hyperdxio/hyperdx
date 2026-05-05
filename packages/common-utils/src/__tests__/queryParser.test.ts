import {
  parse,
  SearchQueryBuilder,
  TrinoSchemaConfig,
  TrinoSchemaSerializer,
} from '@/queryParser';

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('TrinoSchemaSerializer', () => {
  const schema: TrinoSchemaConfig = {
    columns: [
      { name: 'level', type: 'varchar' },
      { name: 'host', type: 'varchar' },
      { name: 'event_time', type: 'timestamp' },
      { name: 'count', type: 'bigint' },
      { name: 'is_error', type: 'boolean' },
      { name: 'attrs', type: 'json' },
    ],
    timestampColumn: 'event_time',
  };

  it('emits Trino-flavored LIKE for free-text matches across string columns', async () => {
    const ast = parse('error');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain("lower(\"level\") LIKE lower('%error%')");
    expect(sql).toContain("lower(\"host\") LIKE lower('%error%')");
  });

  it('uses double-quoted identifiers for fielded matches', async () => {
    const ast = parse('level:error');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('lower("level") LIKE');
    expect(sql).toContain("lower('%error%')");
  });

  it('emits exact equality for quoted Lucene strings', async () => {
    const ast = parse('level:"ERROR"');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('("level" = \'ERROR\')');
  });

  it('emits numeric comparisons against numeric columns', async () => {
    const ast = parse('count:>=10 AND count:<100');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('"count" >= 10');
    expect(sql).toContain('"count" < 100');
  });

  it('emits BETWEEN for ranged Lucene queries on numeric columns', async () => {
    const ast = parse('count:[10 TO 100]');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('"count" BETWEEN 10 AND 100');
  });

  it('emits boolean equality for boolean columns', async () => {
    const ast = parse('is_error:true');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('"is_error" = true');
  });

  it('emits json_extract_scalar for JSON path access', async () => {
    const ast = parse('attrs.user.id:42');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain(
      "json_extract_scalar(\"attrs\", '$.user.id')",
    );
  });

  it('emits IS NOT NULL for Lucene wildcard existence', async () => {
    const ast = parse('host:*');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('"host" IS NOT NULL');
  });

  it('does not emit ClickHouse-specific time bucketing functions', async () => {
    const ast = parse('level:error');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).not.toContain('toStartOfInterval');
    expect(sql).not.toContain('fromUnixTimestamp64Milli');
  });

  it('rejects unknown columns with a descriptive error', async () => {
    const ast = parse('nope:foo');
    await expect(
      new TrinoSchemaSerializer(schema).serialize(ast),
    ).rejects.toThrow(/column.*nope.*not.*found/i);
  });

  it('omits time-window injection when timestampColumn is unset', async () => {
    const noTimeSchema: TrinoSchemaConfig = {
      ...schema,
      timestampColumn: undefined,
      timeRange: { startMs: 1_700_000_000_000, endMs: 1_700_000_999_000 },
    };
    const ast = parse('level:error');
    const sql = await new TrinoSchemaSerializer(noTimeSchema).serialize(ast);
    expect(sql).not.toMatch(/event_time\s+BETWEEN/);
    expect(sql).not.toContain('from_unixtime');
  });

  it('injects time-window predicate when both timestampColumn and timeRange are set', async () => {
    const tsSchema: TrinoSchemaConfig = {
      ...schema,
      timeRange: { startMs: 1_700_000_000_000, endMs: 1_700_000_999_000 },
    };
    const ast = parse('level:error');
    const sql = await new TrinoSchemaSerializer(tsSchema).serialize(ast);
    expect(sql).toMatch(/"event_time"\s+BETWEEN\s+from_unixtime\(/);
  });

  it('respects implicitColumnExpression for bare-text matches', async () => {
    const implicitSchema: TrinoSchemaConfig = {
      ...schema,
      implicitColumnExpression: '"level"',
    };
    const ast = parse('boom');
    const sql = await new TrinoSchemaSerializer(implicitSchema).serialize(ast);
    expect(sql).toContain('lower("level") LIKE');
    expect(sql).toContain("lower('%boom%')");
  });

  it('escapes single quotes in string literals', async () => {
    const ast = parse('host:"o\'reilly"');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain("'o''reilly'");
  });

  it('handles AND/OR composition', async () => {
    const ast = parse('level:error AND count:>5');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('AND');
    expect(sql).toContain('"level"');
    expect(sql).toContain('"count" > 5');
  });

  it('handles NOT (negated field) for fieldSearch', async () => {
    const ast = parse('-level:error');
    const sql = await new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('NOT');
    expect(sql).toContain('lower("level")');
  });
});

describe('SearchQueryBuilder integration with TrinoSchemaSerializer', () => {
  const schema: TrinoSchemaConfig = {
    columns: [
      { name: 'level', type: 'varchar' },
      { name: 'count', type: 'bigint' },
    ],
  };

  it('builds a WHERE clause via the serializer', async () => {
    const serializer = new TrinoSchemaSerializer(schema);
    const builder = new SearchQueryBuilder('level:error', serializer);
    const where = await builder.build();
    expect(where).toContain('lower("level") LIKE');
  });

  it('and()-condition is preserved alongside the search clause', async () => {
    const serializer = new TrinoSchemaSerializer(schema);
    const builder = new SearchQueryBuilder('level:error', serializer);
    builder.and('"count" > 0');
    const where = await builder.build();
    expect(where).toContain('"count" > 0');
    expect(where).toContain('lower("level") LIKE');
  });

  it('returns just the and() conditions when search query is empty', async () => {
    const serializer = new TrinoSchemaSerializer(schema);
    const builder = new SearchQueryBuilder('', serializer);
    builder.and('"count" > 0');
    const where = await builder.build();
    expect(where).toBe('("count" > 0)');
  });
});
