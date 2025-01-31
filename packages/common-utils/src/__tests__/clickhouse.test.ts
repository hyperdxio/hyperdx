import { convertCHDataTypeToJSType, JSDataType } from '@/clickhouse';

describe('convertCHDataTypeToJSType - unit - type', () => {
  it('Date type', () => {
    const dataType = 'Date';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Date);
  });

  it('Map type', () => {
    const dataType = 'Map';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Map);
  });

  it('Array type', () => {
    const dataType = 'Array';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Array);
  });

  it('Number type - Int', () => {
    const dataType = 'Int';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - UInt', () => {
    const dataType = 'UInt';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Float', () => {
    const dataType = 'Float';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Nullable(Int', () => {
    const dataType = 'Nullable(Int';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Nullable(UInt', () => {
    const dataType = 'Nullable(UInt';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Nullable(Float', () => {
    const dataType = 'Nullable(Float';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('String type - String', () => {
    const dataType = 'String';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - FixedString', () => {
    const dataType = 'FixedString';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - Enum', () => {
    const dataType = 'Enum';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - UUID', () => {
    const dataType = 'UUID';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - IPv4', () => {
    const dataType = 'IPv4';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - IPv6', () => {
    const dataType = 'IPv6';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('Bool type', () => {
    const dataType = 'Bool';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Bool);
  });

  it('JSON type', () => {
    const dataType = 'JSON';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.JSON);
  });

  it('Dynamic type', () => {
    const dataType = 'Dynamic';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Dynamic);
  });

  it('LowCardinality type - Date', () => {
    const dataType = 'LowCardinality(Date)';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Date);
  });

  it('LowCardinality type - Number', () => {
    const dataType = 'LowCardinality(Int)';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('LowCardinality type - String', () => {
    const dataType = 'LowCardinality(String)';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('Unknown type', () => {
    const dataType = ')@#D)#Q$J)($*()@random type should not pass';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBeNull();
  });
});
