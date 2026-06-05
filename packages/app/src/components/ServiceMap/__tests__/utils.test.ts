import router from 'next/router';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import {
  deriveDisplayMetrics,
  formatApproximateNumber,
  formatRate,
  getNodeColors,
  getNodeSize,
  getRequestsPerSecond,
  navigateToTraceSearch,
  rawDurationToMs,
} from '../utils';

// Mock next/router
jest.mock('next/router', () => ({
  __esModule: true,
  default: {
    push: jest.fn(),
  },
}));

describe('navigateToTraceSearch', () => {
  const mockSource: TTraceSource = {
    id: 'test-source-id',
    name: 'Test Source',
    from: {
      tableName: 'test_table',
      databaseName: 'test_db',
    },
    timestampValueExpression: 'timestamp',
    defaultTableSelectExpression: 'timestamp',
    connection: 'test-connection',
    kind: SourceKind.Trace,
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should navigate to search page with correct query parameters', () => {
    const dateRange: [Date, Date] = [
      new Date('2024-01-15T10:00:00.000Z'),
      new Date('2024-01-15T11:00:00.000Z'),
    ];

    navigateToTraceSearch({
      dateRange,
      source: mockSource,
      where: "service_name = 'my-service'",
    });

    expect(router.push).toHaveBeenCalledTimes(1);

    const callArg = (router.push as jest.Mock).mock.calls[0][0];
    expect(callArg).toContain('/search?');

    // Parse query params
    const url = new URL(callArg, 'http://localhost');
    const params = url.searchParams;

    expect(params.get('isLive')).toBe('false');
    expect(params.get('source')).toBe('test-source-id');
    expect(params.get('where')).toBe("service_name = 'my-service'");
    expect(params.get('whereLanguage')).toBe('sql');
    expect(params.get('from')).toBe('1705312800000');
    expect(params.get('to')).toBe('1705316400000');
  });

  it('should handle different date ranges', () => {
    const dateRange: [Date, Date] = [
      new Date('2023-12-01T00:00:00.000Z'),
      new Date('2023-12-31T23:59:59.999Z'),
    ];

    navigateToTraceSearch({
      dateRange,
      source: mockSource,
      where: 'status_code = 500',
    });

    const callArg = (router.push as jest.Mock).mock.calls[0][0];
    const url = new URL(callArg, 'http://localhost');
    const params = url.searchParams;

    expect(params.get('from')).toBe('1701388800000');
    expect(params.get('to')).toBe('1704067199999');
  });

  it('should handle complex where clauses', () => {
    const dateRange: [Date, Date] = [
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-02T00:00:00.000Z'),
    ];

    const complexWhere =
      "service_name = 'my-service' AND status_code >= 400 AND span_kind = 'server'";

    navigateToTraceSearch({
      dateRange,
      source: mockSource,
      where: complexWhere,
    });

    const callArg = (router.push as jest.Mock).mock.calls[0][0];
    const url = new URL(callArg, 'http://localhost');
    const params = url.searchParams;

    expect(params.get('where')).toBe(complexWhere);
  });

  it('should handle special characters in where clause', () => {
    const dateRange: [Date, Date] = [
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-02T00:00:00.000Z'),
    ];

    const whereWithSpecialChars = "service_name = 'test&service=value'";

    navigateToTraceSearch({
      dateRange,
      source: mockSource,
      where: whereWithSpecialChars,
    });

    const callArg = (router.push as jest.Mock).mock.calls[0][0];
    const url = new URL(callArg, 'http://localhost');
    const params = url.searchParams;

    // URL encoding should preserve the where clause
    expect(params.get('where')).toBe(whereWithSpecialChars);
  });
});

describe('formatApproximateNumber', () => {
  describe('numbers less than 1000', () => {
    it('should format zero correctly', () => {
      expect(formatApproximateNumber(0)).toBe('~0');
    });

    it('should format small positive numbers correctly', () => {
      expect(formatApproximateNumber(1)).toBe('~1');
      expect(formatApproximateNumber(42)).toBe('~42');
      expect(formatApproximateNumber(999)).toBe('~999');
    });

    it('should format decimal numbers correctly', () => {
      expect(formatApproximateNumber(1.5)).toBe('~1.5');
      expect(formatApproximateNumber(42.7)).toBe('~42.7');
      expect(formatApproximateNumber(999.99)).toBe('~999.99');
    });
  });

  describe('thousands (1K - 999K)', () => {
    it('should format exact thousands correctly', () => {
      expect(formatApproximateNumber(1000)).toBe('~1k');
      expect(formatApproximateNumber(5000)).toBe('~5k');
      expect(formatApproximateNumber(10000)).toBe('~10k');
    });

    it('should round to nearest thousand', () => {
      expect(formatApproximateNumber(1234)).toBe('~1k');
      expect(formatApproximateNumber(1500)).toBe('~2k');
      expect(formatApproximateNumber(1499)).toBe('~1k');
      expect(formatApproximateNumber(9876)).toBe('~10k');
    });

    it('should handle values near million boundary', () => {
      expect(formatApproximateNumber(999000)).toBe('~999k');
      expect(formatApproximateNumber(999499)).toBe('~999k');
      expect(formatApproximateNumber(999500)).toBe('~1000k');
    });
  });

  describe('millions (1M - 999M)', () => {
    it('should format exact millions correctly', () => {
      expect(formatApproximateNumber(1_000_000)).toBe('~1M');
      expect(formatApproximateNumber(5_000_000)).toBe('~5M');
      expect(formatApproximateNumber(10_000_000)).toBe('~10M');
    });

    it('should round to nearest million', () => {
      expect(formatApproximateNumber(1_234_567)).toBe('~1M');
      expect(formatApproximateNumber(1_500_000)).toBe('~2M');
      expect(formatApproximateNumber(1_499_999)).toBe('~1M');
      expect(formatApproximateNumber(9_876_543)).toBe('~10M');
    });

    it('should handle values near billion boundary', () => {
      expect(formatApproximateNumber(999_000_000)).toBe('~999M');
      expect(formatApproximateNumber(999_499_999)).toBe('~999M');
      expect(formatApproximateNumber(999_500_000)).toBe('~1000M');
    });
  });

  describe('billions (1B+)', () => {
    it('should format exact billions correctly', () => {
      expect(formatApproximateNumber(1_000_000_000)).toBe('~1B');
      expect(formatApproximateNumber(5_000_000_000)).toBe('~5B');
      expect(formatApproximateNumber(10_000_000_000)).toBe('~10B');
    });

    it('should round to nearest billion', () => {
      expect(formatApproximateNumber(1_234_567_890)).toBe('~1B');
      expect(formatApproximateNumber(1_500_000_000)).toBe('~2B');
      expect(formatApproximateNumber(1_499_999_999)).toBe('~1B');
      expect(formatApproximateNumber(9_876_543_210)).toBe('~10B');
    });

    it('should handle very large numbers', () => {
      expect(formatApproximateNumber(999_000_000_000)).toBe('~999B');
      expect(formatApproximateNumber(1_000_000_000_000)).toBe('~1000B');
    });
  });

  describe('edge cases', () => {
    it('should handle boundary values precisely', () => {
      expect(formatApproximateNumber(999.99)).toBe('~999.99');
      expect(formatApproximateNumber(1000.01)).toBe('~1k');
      expect(formatApproximateNumber(999_999.99)).toBe('~1000k');
      expect(formatApproximateNumber(1_000_000.01)).toBe('~1M');
      expect(formatApproximateNumber(999_999_999.99)).toBe('~1000M');
      expect(formatApproximateNumber(1_000_000_000.01)).toBe('~1B');
    });
  });
});

describe('getNodeColors', () => {
  describe('background color calculation', () => {
    it('should return light background when error percent is 0', () => {
      const colors = getNodeColors(0, 20, false);
      expect(colors.backgroundColor).toBe('hsl(0 0% 80%)');
    });

    it('should calculate background color based on error percentage', () => {
      const colors = getNodeColors(10, 20, false);
      // (10 / 20) * 100 = 50% saturation
      expect(colors.backgroundColor).toBe('hsl(0 50% 80%)');
    });

    it('should use full saturation when error percent equals max', () => {
      const colors = getNodeColors(20, 20, false);
      // (20 / 20) * 100 = 100% saturation
      expect(colors.backgroundColor).toBe('hsl(0 100% 80%)');
    });

    it('should cap at max error rate even if actual error is higher', () => {
      const colors = getNodeColors(30, 20, false);
      // Math.min(20, 30) = 20, (20 / 20) * 100 = 100% saturation
      expect(colors.backgroundColor).toBe('hsl(0 100% 80%)');
    });

    it('should handle very small error percentages', () => {
      const colors = getNodeColors(0.1, 20, false);
      // (0.1 / 20) * 100 = 0.5% saturation
      expect(colors.backgroundColor).toBe('hsl(0 0.5% 80%)');
    });

    it('should handle when maxErrorPercent is 0', () => {
      // This would cause division by zero, but Math results in Infinity
      const colors = getNodeColors(5, 0, false);
      expect(colors.backgroundColor).toContain('hsl(0');
    });
  });

  describe('border color calculation', () => {
    it('should return white border when node is selected', () => {
      const colors = getNodeColors(10, 20, true);
      expect(colors.borderColor).toBe('white');
    });

    it('should return calculated border color when not selected', () => {
      const colors = getNodeColors(10, 20, false);
      // (10 / 20) * 100 = 50% saturation with 40% lightness
      expect(colors.borderColor).toBe('hsl(0 50% 40%)');
    });

    it('should return dark border for high error rates when not selected', () => {
      const colors = getNodeColors(20, 20, false);
      expect(colors.borderColor).toBe('hsl(0 100% 40%)');
    });

    it('should return light border for zero errors when not selected', () => {
      const colors = getNodeColors(0, 20, false);
      expect(colors.borderColor).toBe('hsl(0 0% 40%)');
    });

    it('should cap border color saturation like background', () => {
      const colors = getNodeColors(30, 20, false);
      // Should cap at 20% error rate
      expect(colors.borderColor).toBe('hsl(0 100% 40%)');
    });
  });

  describe('selected state', () => {
    it('should always use white border when selected regardless of error rate', () => {
      expect(getNodeColors(0, 20, true).borderColor).toBe('white');
      expect(getNodeColors(5, 20, true).borderColor).toBe('white');
      expect(getNodeColors(10, 20, true).borderColor).toBe('white');
      expect(getNodeColors(20, 20, true).borderColor).toBe('white');
      expect(getNodeColors(30, 20, true).borderColor).toBe('white');
    });

    it('should still calculate background color correctly when selected', () => {
      const colors = getNodeColors(10, 20, true);
      expect(colors.backgroundColor).toBe('hsl(0 50% 80%)');
      expect(colors.borderColor).toBe('white');
    });
  });

  describe('various error percentage scenarios', () => {
    it('should handle low error rates', () => {
      const colors = getNodeColors(1, 20, false);
      expect(colors.backgroundColor).toBe('hsl(0 5% 80%)');
      expect(colors.borderColor).toBe('hsl(0 5% 40%)');
    });

    it('should handle medium error rates', () => {
      const colors = getNodeColors(10, 20, false);
      expect(colors.backgroundColor).toBe('hsl(0 50% 80%)');
      expect(colors.borderColor).toBe('hsl(0 50% 40%)');
    });

    it('should handle high error rates', () => {
      const colors = getNodeColors(18, 20, false);
      expect(colors.backgroundColor).toBe('hsl(0 90% 80%)');
      expect(colors.borderColor).toBe('hsl(0 90% 40%)');
    });
  });

  describe('return value structure', () => {
    it('should return an object with backgroundColor and borderColor', () => {
      const colors = getNodeColors(10, 20, false);
      expect(colors).toHaveProperty('backgroundColor');
      expect(colors).toHaveProperty('borderColor');
      expect(typeof colors.backgroundColor).toBe('string');
      expect(typeof colors.borderColor).toBe('string');
    });

    it('should return different objects for different inputs', () => {
      const colors1 = getNodeColors(5, 20, false);
      const colors2 = getNodeColors(10, 20, false);
      expect(colors1).not.toEqual(colors2);
    });
  });
});

describe('rawDurationToMs', () => {
  it('converts nanoseconds (precision 9) to milliseconds', () => {
    // 1_000_000 ns = 1 ms
    expect(rawDurationToMs(1_000_000, 9)).toBe(1);
    expect(rawDurationToMs(2_500_000, 9)).toBe(2.5);
  });

  it('converts microseconds (precision 6) to milliseconds', () => {
    // 1000 µs = 1 ms
    expect(rawDurationToMs(1000, 6)).toBe(1);
    expect(rawDurationToMs(500, 6)).toBe(0.5);
  });

  it('treats precision 3 as already-milliseconds', () => {
    expect(rawDurationToMs(42, 3)).toBe(42);
  });

  it('scales up for precision below 3 (e.g. seconds)', () => {
    // precision 0 = seconds: 7s -> 7000ms (divisor is 10^-3, i.e. multiply up)
    expect(rawDurationToMs(7, 0)).toBe(7000);
  });

  it('handles zero', () => {
    expect(rawDurationToMs(0, 9)).toBe(0);
  });
});

describe('getRequestsPerSecond', () => {
  const oneHour: [Date, Date] = [
    new Date('2024-01-01T00:00:00.000Z'),
    new Date('2024-01-01T01:00:00.000Z'),
  ];

  it('divides total requests by the window in seconds', () => {
    // 3600 requests over 3600s = 1/s
    expect(getRequestsPerSecond(3600, oneHour)).toBe(1);
    expect(getRequestsPerSecond(7200, oneHour)).toBe(2);
  });

  it('returns 0 for a zero-length window', () => {
    const t = new Date('2024-01-01T00:00:00.000Z');
    expect(getRequestsPerSecond(100, [t, t])).toBe(0);
  });

  it('returns 0 for an inverted window', () => {
    expect(getRequestsPerSecond(100, [oneHour[1], oneHour[0]])).toBe(0);
  });
});

describe('formatRate', () => {
  it('formats sub-1/s rates with two decimals and a req/s label', () => {
    expect(formatRate(0)).toBe('0 req/s');
    expect(formatRate(0.2)).toBe('0.20 req/s');
  });

  it('formats 1-999/s with one decimal', () => {
    expect(formatRate(1)).toBe('1.0 req/s');
    expect(formatRate(3.45)).toBe('3.5 req/s');
    expect(formatRate(999)).toBe('999.0 req/s');
  });

  it('formats >=1000/s in thousands', () => {
    expect(formatRate(1000)).toBe('1.0k req/s');
    expect(formatRate(12345)).toBe('12.3k req/s');
  });

  it('returns 0 req/s for non-finite or negative input', () => {
    expect(formatRate(Infinity)).toBe('0 req/s');
    expect(formatRate(NaN)).toBe('0 req/s');
    expect(formatRate(-5)).toBe('0 req/s');
  });
});

describe('getNodeSize', () => {
  it('returns the minimum size when there is no traffic to compare', () => {
    expect(getNodeSize(0, 0)).toBe(32);
    expect(getNodeSize(0, 100)).toBe(32);
  });

  it('returns the maximum size for the busiest node', () => {
    // ratio = sqrt(100/100) = 1 -> MAX
    expect(getNodeSize(100, 100)).toBe(60);
  });

  it('scales by the square root of the request ratio', () => {
    // sqrt(25/100) = 0.5 -> 32 + 0.5*(60-32) = 46
    expect(getNodeSize(25, 100)).toBe(46);
  });

  it('clamps requests above the max to the max size', () => {
    expect(getNodeSize(200, 100)).toBe(60);
  });

  it('stays within [32, 60]', () => {
    for (const r of [1, 10, 50, 99, 100]) {
      const size = getNodeSize(r, 100);
      expect(size).toBeGreaterThanOrEqual(32);
      expect(size).toBeLessThanOrEqual(60);
    }
  });
});

describe('deriveDisplayMetrics', () => {
  const source = { durationPrecision: 9 } as unknown as TTraceSource;
  const oneHour: [Date, Date] = [
    new Date('2024-01-01T00:00:00.000Z'),
    new Date('2024-01-01T01:00:00.000Z'),
  ];

  it('converts percentiles to ms and computes throughput', () => {
    const m = deriveDisplayMetrics(
      {
        totalRequests: 3600,
        p50: 1_000_000,
        p95: 5_000_000,
        p99: 9_000_000,
        hasLatency: true,
      },
      source,
      oneHour,
    );
    expect(m.latencyMs).toEqual({ p50: 1, p95: 5, p99: 9 });
    expect(m.requestsPerSecond).toBe(1);
  });

  it('omits latency when hasLatency is false', () => {
    const m = deriveDisplayMetrics(
      { totalRequests: 10, p50: 0, p95: 0, p99: 0, hasLatency: false },
      source,
      oneHour,
    );
    expect(m.latencyMs).toBeUndefined();
  });

  it('omits throughput for single-trace maps but keeps latency', () => {
    const m = deriveDisplayMetrics(
      {
        totalRequests: 10,
        p50: 1_000_000,
        p95: 1_000_000,
        p99: 1_000_000,
        hasLatency: true,
      },
      source,
      oneHour,
      true,
    );
    expect(m.requestsPerSecond).toBeUndefined();
    expect(m.latencyMs).toBeDefined();
  });
});
