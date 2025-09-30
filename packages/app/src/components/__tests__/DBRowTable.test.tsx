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
});
