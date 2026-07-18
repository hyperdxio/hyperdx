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

describe('BaseClickhouseClient.logDebugQuery', () => {
  const client = new ClickhouseClient({ host: 'http://localhost' });
  const logDebugQuery = (query: string) => (client as any).logDebugQuery(query);
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.HYPERDX_LOG_QUERIES;
  });

  it('logs the query when HYPERDX_LOG_QUERIES=true', () => {
    process.env.HYPERDX_LOG_QUERIES = 'true';
    logDebugQuery('SELECT 1 FROM system.one');
    expect(debugSpy).toHaveBeenCalledWith(
      'Sending Query:',
      'SELECT 1 FROM system.one',
    );
  });

  it('stays silent otherwise', () => {
    delete process.env.HYPERDX_LOG_QUERIES;
    logDebugQuery('SELECT 1 FROM system.one');
    for (const value of ['', 'false', '1', 'TRUE']) {
      process.env.HYPERDX_LOG_QUERIES = value;
      logDebugQuery('SELECT 1 FROM system.one');
    }
    expect(debugSpy).not.toHaveBeenCalled();
  });
});
