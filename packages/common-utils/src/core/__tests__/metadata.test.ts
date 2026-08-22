import { Metadata, MetadataCache } from '@/core/metadata';
import { isDateRangeValid } from '@/core/utils';
import type { BaseClickhouseClient } from '@/clickhouse';
const invalidDate = new Date('not-a-date');

describe('isDateRangeValid', () => {
  it('accepts valid date ranges', () => {
    expect(
      isDateRangeValid([
        new Date('2026-08-01T00:00:00Z'),
        new Date('2026-08-02T00:00:00Z'),
      ]),
    ).toBe(true);
  });

  it('rejects a range with an invalid start', () => {
    expect(isDateRangeValid([invalidDate, new Date()])).toBe(false);
  });

  it('rejects a range with an invalid end', () => {
    expect(isDateRangeValid([new Date(), invalidDate])).toBe(false);
  });
});

describe('getMapKeys date range guard', () => {
  it('returns [] and never queries ClickHouse for an invalid date range', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('should not be called'));
    const metadata = new Metadata(
      query as unknown as BaseClickhouseClient,
      new MetadataCache(),
    );

    const keys = await metadata.getMapKeys({
      databaseName: 'db',
      tableName: 'tbl',
      column: 'attributes',
      connectionId: 'conn',
      metadataMVs: { granularity: 'minute' } as any,
      dateRange: [invalidDate, invalidDate],
    });

    expect(keys).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
