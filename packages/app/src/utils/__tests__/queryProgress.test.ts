import {
  ChunkProgress,
  MAX_DISPLAYED_PERCENT,
  progressFraction,
  summarizeChunkProgress,
  toChunkProgress,
} from '@/utils/queryProgress';

const HOUR = 60 * 60 * 1000;

function chunk(overrides: Partial<ChunkProgress> = {}): ChunkProgress {
  return {
    rangeMs: HOUR,
    readRows: 0,
    readBytes: 0,
    fraction: undefined,
    isComplete: false,
    ...overrides,
  };
}

describe('progressFraction', () => {
  it('divides read rows by the estimated total', () => {
    expect(
      progressFraction({
        read_rows: '25',
        read_bytes: '100',
        total_rows_to_read: '100',
        elapsed_ns: '1',
      }),
    ).toBe(0.25);
  });

  it('clamps to 1 when read rows exceed the estimate', () => {
    expect(
      progressFraction({
        read_rows: '250',
        read_bytes: '100',
        total_rows_to_read: '100',
        elapsed_ns: '1',
      }),
    ).toBe(1);
  });

  it('is undefined when no estimate has been reported yet', () => {
    expect(
      progressFraction({
        read_rows: '25',
        read_bytes: '100',
        elapsed_ns: '1',
      }),
    ).toBeUndefined();
    expect(
      progressFraction({
        read_rows: '25',
        read_bytes: '100',
        total_rows_to_read: '0',
        elapsed_ns: '1',
      }),
    ).toBeUndefined();
  });
});

describe('toChunkProgress', () => {
  it('parses the stringified counters', () => {
    expect(
      toChunkProgress(
        {
          read_rows: '120',
          read_bytes: '4096',
          total_rows_to_read: '480',
          elapsed_ns: '1',
        },
        HOUR,
      ),
    ).toEqual({
      rangeMs: HOUR,
      readRows: 120,
      readBytes: 4096,
      fraction: 0.25,
      isComplete: false,
    });
  });

  it('treats absent or non-numeric counters as zero', () => {
    expect(
      // Counters are strings on the wire, so a malformed one is well-typed.
      toChunkProgress(
        { read_rows: 'abc', read_bytes: '', elapsed_ns: '1' },
        HOUR,
      ),
    ).toMatchObject({ readRows: 0, readBytes: 0, fraction: undefined });
  });
});

describe('summarizeChunkProgress', () => {
  it('is indeterminate before anything measurable arrives', () => {
    expect(
      summarizeChunkProgress({
        chunks: [chunk({ readRows: 10 })],
        totalRangeMs: 4 * HOUR,
        elapsedMs: 100,
      }),
    ).toEqual({
      percent: undefined,
      readRows: 10,
      readBytes: 0,
      elapsedMs: 100,
    });
  });

  it('weights each window by its share of the whole range', () => {
    // One full hour done, plus half of a second hour, over a 4h range.
    const summary = summarizeChunkProgress({
      chunks: [
        chunk({ isComplete: true, readRows: 100 }),
        chunk({ fraction: 0.5, readRows: 40 }),
      ],
      totalRangeMs: 4 * HOUR,
      elapsedMs: 500,
    });

    expect(summary.percent).toBeCloseTo(37.5);
    expect(summary.readRows).toBe(140);
  });

  it('counts a complete chunk in full regardless of its last fraction', () => {
    const summary = summarizeChunkProgress({
      chunks: [chunk({ isComplete: true, fraction: 0.3 })],
      totalRangeMs: 2 * HOUR,
      elapsedMs: 1,
    });

    expect(summary.percent).toBeCloseTo(50);
  });

  it('adds windows already completed outside the live chunk set', () => {
    const summary = summarizeChunkProgress({
      chunks: [chunk({ fraction: 0.5, readRows: 5, readBytes: 50 })],
      totalRangeMs: 4 * HOUR,
      completedRangeMs: 2 * HOUR,
      completedRows: 900,
      completedBytes: 9000,
      elapsedMs: 20,
    });

    expect(summary.percent).toBeCloseTo(62.5);
    expect(summary.readRows).toBe(905);
    expect(summary.readBytes).toBe(9050);
  });

  it('reports a percentage from completed windows alone', () => {
    const summary = summarizeChunkProgress({
      chunks: [],
      totalRangeMs: 4 * HOUR,
      completedRangeMs: HOUR,
      elapsedMs: 5,
    });

    expect(summary.percent).toBeCloseTo(25);
  });

  it('caps below 100 so a running query never looks finished', () => {
    const summary = summarizeChunkProgress({
      chunks: [chunk({ isComplete: true, rangeMs: 10 * HOUR })],
      totalRangeMs: HOUR,
      elapsedMs: 1,
    });

    expect(summary.percent).toBe(MAX_DISPLAYED_PERCENT);
  });

  it('sums counters across parallel chunks', () => {
    const summary = summarizeChunkProgress({
      chunks: [
        chunk({ readRows: 10, readBytes: 100 }),
        chunk({ readRows: 20, readBytes: 200 }),
        chunk({ readRows: 30, readBytes: 300 }),
      ],
      totalRangeMs: 3 * HOUR,
      elapsedMs: 7,
    });

    expect(summary.readRows).toBe(60);
    expect(summary.readBytes).toBe(600);
  });

  it('is indeterminate when the total range is unknown', () => {
    const summary = summarizeChunkProgress({
      chunks: [chunk({ isComplete: true })],
      totalRangeMs: 0,
      elapsedMs: 1,
    });

    expect(summary.percent).toBeUndefined();
  });
});
