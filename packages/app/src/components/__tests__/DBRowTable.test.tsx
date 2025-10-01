import { appendSelectWithPrimaryAndPartitionKey } from '@/components/DBRowTable';

describe('appendSelectWithPrimaryAndPartitionKey', () => {
  it('should extract columns from partition key with nested function call', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      'id, created_at',
      ' toStartOfInterval(timestamp, toIntervalDay(3))',
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: 'col1,col2,timestamp,id,created_at',
    });
  });

  it('should extract no columns from empty primary key and partition key', () => {
    const result = appendSelectWithPrimaryAndPartitionKey('col1, col2', '', '');
    expect(result).toEqual({
      additionalKeysLength: 0,
      select: 'col1,col2',
    });
  });

  it('should extract columns from complex primary key', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      'id, timestamp, toStartOfInterval(timestamp2, toIntervalDay(3))',
      "toStartOfInterval(timestamp, toIntervalDay(3)), date_diff('DAY', col3, col4), now(), toDate(col5 + INTERVAL 1 DAY)",
    );
    expect(result).toEqual({
      additionalKeysLength: 6,
      select: 'col1,col2,timestamp,col3,col4,col5,id,timestamp2',
    });
  });

  it('should extract map columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `map['key']`,
      `map2['key'], map1['key3 ']`,
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: `col1,col2,map2['key'],map1['key3 '],map['key']`,
    });
  });

  it('should extract array columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `array[1]`,
      `array[2], array[3]`,
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: `col1,col2,array[2],array[3],array[1]`,
    });
  });

  it('should extract json columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `json.b`,
      `json.a, json.b.c, toStartOfDay(timestamp, json_2.d)`,
    );
    expect(result).toEqual({
      additionalKeysLength: 5,
      select: `col1,col2,json.a,json.b.c,timestamp,json_2.d,json.b`,
    });
  });

  it('should extract json columns with type specifiers', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `json.b.:Int64`,
      `toStartOfDay(json.a.b.:DateTime)`,
    );
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: `col1,col2,json.a.b,json.b`,
    });
  });

  it('should skip json columns with hard-to-parse type specifiers', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `json.b.:Array(String), col3`,
      ``,
    );
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: `col1,col2,col3`,
    });
  });

  it('should skip nested map references', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `map['key']['key2'], col3`,
      ``,
    );
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: `col1,col2,col3`,
    });
  });
});
