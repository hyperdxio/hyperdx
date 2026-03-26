import {
  convertCHDataTypeToJSType,
  extractColumnReferencesFromKey,
  JSDataType,
} from '..';

describe('extractColumnReferencesFromKey', () => {
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
