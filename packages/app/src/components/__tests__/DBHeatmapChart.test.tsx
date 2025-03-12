import { transformHeatmapData } from '../DBHeatmapChart';

describe('DBHeatmapChart data transformation', () => {
  const mockTimestampColumn = {
    name: 'timestamp',
    type: 'DateTime',
  };

  test('correctly transforms data with multiple timestamps and buckets', () => {
    const mockData = {
      data: [
        { timestamp: '2024-01-01T00:00:00Z', bucket: 1, count: '5' },
        { timestamp: '2024-01-01T00:00:00Z', bucket: 2, count: '10' },
        { timestamp: '2024-01-01T00:01:00Z', bucket: 1, count: '15' },
      ],
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'bucket', type: 'Int32' },
        { name: 'count', type: 'Int64' },
      ],
    };

    const timestampColumn = { name: 'timestamp' };
    const timestamps = [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T00:01:00Z'),
    ];
    const min = 0;
    const max = 100;
    const nBuckets = 10;

    const result = transformHeatmapData(
      mockData,
      timestampColumn,
      timestamps,
      min,
      max,
      nBuckets,
    );

    expect(result.time.length).toBe(timestamps.length * (nBuckets + 2));
    expect(result.bucket.length).toBe(timestamps.length * (nBuckets + 2));
    expect(result.count.length).toBe(timestamps.length * (nBuckets + 2));

    // Test specific values
    expect(result.count[1]).toBe(5);
    expect(result.count[2]).toBe(10);
    expect(result.count[nBuckets + 3]).toBe(15);
  });

  test('handles empty data', () => {
    const min = 0;
    const max = 100;
    const nBuckets = 10;

    const timestamps = [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T00:01:00Z'),
    ];

    const result = transformHeatmapData(
      { data: [] },
      mockTimestampColumn,
      timestamps,
      min,
      max,
      nBuckets,
    );

    // Should still create entries for all timestamps and buckets, but with 0 counts
    expect(result.time.length).toBe(timestamps.length * (nBuckets + 2));
    expect(result.bucket.length).toBe(timestamps.length * (nBuckets + 2));
    expect(result.count.length).toBe(timestamps.length * (nBuckets + 2));

    // All counts should be 0
    expect(result.count.every(count => count === 0)).toBe(true);
  });

  test('handles non-sequential buckets', () => {
    const min = 0;
    const max = 100;
    const nBuckets = 10;

    const timestamps = [new Date('2024-01-01T00:00:00Z')];

    const mockData = {
      data: [
        { timestamp: '2024-01-01T00:00:00Z', bucket: 0, count: '5' },
        { timestamp: '2024-01-01T00:00:00Z', bucket: 5, count: '10' },
        { timestamp: '2024-01-01T00:00:00Z', bucket: 10, count: '15' },
      ],
    };

    const result = transformHeatmapData(
      mockData,
      mockTimestampColumn,
      timestamps,
      min,
      max,
      nBuckets,
    );

    // Verify specific counts are correct
    expect(result.count[0]).toBe(5); // bucket 0
    expect(result.count[5]).toBe(10); // bucket 5
    expect(result.count[10]).toBe(15); // bucket 10

    // Verify gaps are filled with 0
    expect(result.count[1]).toBe(0);
    expect(result.count[4]).toBe(0);
    expect(result.count[6]).toBe(0);
  });

  test('handles timestamps with no data', () => {
    const min = 0;
    const max = 100;
    const nBuckets = 10;

    const timestamps = [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T00:01:00Z'),
    ];

    const mockData = {
      data: [
        { timestamp: '2024-01-01T00:00:00Z', bucket: 1, count: '5' },
        // No data for second timestamp
      ],
    };

    const result = transformHeatmapData(
      mockData,
      mockTimestampColumn,
      timestamps,
      min,
      max,
      nBuckets,
    );

    // First timestamp should have data
    expect(result.count[1]).toBe(5);

    // Second timestamp should have all zeros
    const secondTimestampCounts = result.count.slice(nBuckets + 2);
    expect(secondTimestampCounts.every(count => count === 0)).toBe(true);
  });
});
