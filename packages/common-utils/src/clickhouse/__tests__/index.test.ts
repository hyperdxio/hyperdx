import {
  ClickHouseQueryError,
  convertCHDataTypeToJSType,
  extractColumnReferencesFromKey,
  isMissingColumnError,
  JSDataType,
} from '@/clickhouse';
import { ClickhouseClient } from '@/clickhouse/node';

describe('isMissingColumnError', () => {
  it.each([
    'Code: 47. DB::Exception: Unknown identifier: foo',
    'DB::Exception: Unknown expression identifier `bar`',
    'UNKNOWN_IDENTIFIER',
    'Missing columns: baz while processing query',
    'Code: 16. NO_SUCH_COLUMN_IN_TABLE',
    'There is no column with name qux',
    'There is no column with name qux',
    "Identifier '__table1.skip_indices' cannot be resolved from table with name __table1.",
  ])('returns true for missing-column error: %s', msg => {
    expect(isMissingColumnError(new Error(msg))).toBe(true);
  });

  it('detects the error via a ClickHouseQueryError instance', () => {
    expect(
      isMissingColumnError(
        new ClickHouseQueryError('Missing columns: foo', 'SELECT * FROM t'),
      ),
    ).toBe(true);
  });

  it.each([
    'Code: 60. DB::Exception: Table default.foo does not exist',
    'Syntax error: failed at position 10',
    'Timeout exceeded',
    '',
  ])('returns false for unrelated error: %s', msg => {
    expect(isMissingColumnError(new Error(msg))).toBe(false);
  });

  it('handles non-Error inputs', () => {
    expect(isMissingColumnError(undefined)).toBe(false);
    expect(isMissingColumnError('Unknown identifier: x')).toBe(true);
  });
});

describe('extractColumnReferencesFromKey', () => {
  // Suppress expected console.error from parse failures in edge-case tests
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should extract column references from simple column names', () => {
    expect(extractColumnReferencesFromKey('col1, col2, col3')).toEqual([
      'col1',
      'col2',
      'col3',
    ]);
  });

  it('should extract column references from function calls', () => {
    expect(
      extractColumnReferencesFromKey(
        "toStartOfInterval(timestamp, toIntervalDay(3)), col2, date_diff('DAY', col3, col4), now(), toDate(col5 + INTERVAL 1 DAY)",
      ),
    ).toEqual(['timestamp', 'col2', 'col3', 'col4', 'col5']);
  });

  it('should handle an empty expression', () => {
    expect(extractColumnReferencesFromKey('')).toEqual([]);
  });

  it('should handle map / json access expression', () => {
    // This is imperfect due to lack of full ClickHouse SQL parsing - we don't pickup the nested map access here.
    // It is not expected to be a common case that there are nested map accesses in a primary or partition key,
    // so we just want to make sure we don't error out in this case.
    expect(
      extractColumnReferencesFromKey("mapCol[otherMap['key']], col2"),
    ).toEqual(['col2']);
  });

  it('should handle array accesses', () => {
    expect(extractColumnReferencesFromKey('arrayCol[1], col2')).toEqual([
      'arrayCol[1]',
      'col2',
    ]);
  });
});

describe('convertCHDataTypeToJSType', () => {
  it('should handle Nullable(DateTime64) as Date', () => {
    expect(convertCHDataTypeToJSType("Nullable(DateTime64(3, 'UTC'))")).toBe(
      JSDataType.Date,
    );
  });

  it('should handle Nullable(Int32) as Number', () => {
    expect(convertCHDataTypeToJSType('Nullable(Int32)')).toBe(
      JSDataType.Number,
    );
  });

  it('should handle Nullable(String) as String', () => {
    expect(convertCHDataTypeToJSType('Nullable(String)')).toBe(
      JSDataType.String,
    );
  });

  it('should handle LowCardinality(Nullable(String)) as String', () => {
    expect(convertCHDataTypeToJSType('LowCardinality(Nullable(String))')).toBe(
      JSDataType.String,
    );
  });

  it('should handle DateTime64 as Date', () => {
    expect(convertCHDataTypeToJSType("DateTime64(3, 'UTC')")).toBe(
      JSDataType.Date,
    );
  });

  it('should handle Nullable(Bool) as Bool', () => {
    expect(convertCHDataTypeToJSType('Nullable(Bool)')).toBe(JSDataType.Bool);
  });
});

describe('BaseClickhouseClient.logQuery', () => {
  const logQuery = (
    client: ClickhouseClient,
    query: string,
    params?: Record<string, any>,
  ) => (client as any).logQuery(query, params);
  const makeLogger = () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays silent when no customLogger is configured', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const client = new ClickhouseClient({ host: 'http://localhost' });
    logQuery(client, 'SELECT 1 FROM system.one');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('logs through the customLogger passed to the client', () => {
    const customLogger = makeLogger();
    const client = new ClickhouseClient({
      host: 'http://localhost',
      customLogger,
    });
    logQuery(client, 'SELECT 1 FROM system.one');
    expect(customLogger.trace).toHaveBeenCalledWith({
      module: 'clickhouse',
      message: 'Sending query',
      args: { sql: 'SELECT 1 FROM system.one' },
    });
  });

  it('interpolates query_params into the logged SQL', () => {
    const customLogger = makeLogger();
    const client = new ClickhouseClient({
      host: 'http://localhost',
      customLogger,
    });
    logQuery(client, 'SELECT {id:Int32}', { id: 5 });
    expect(customLogger.trace).toHaveBeenCalledWith({
      module: 'clickhouse',
      message: 'Sending query',
      args: { sql: 'SELECT 5' },
    });
  });
});
