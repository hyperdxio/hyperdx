import router from 'next/router';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import {
  deriveDisplayMetrics,
  formatApproximateNumber,
  formatRate,
  getMetricGradientCss,
  getNodeColors,
  getNodeSize,
  getRequestsPerSecond,
  getServiceMetricValue,
  navigateToTraceSearch,
  rawDurationToMs,
  SERVICE_MAP_METRIC_HUE,
} from '@/components/ServiceMap/utils';
import type { ServiceAggregation } from '@/hooks/useServiceMap';

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

// Parses an `hsl(H S% L%)` string into numeric components for property-based
// assertions, so tests describe the *shape* of the sequential ramp rather than
// hardcoding tuned endpoint values.
function parseHsl(color: string | undefined): {
  h: number;
  s: number;
  l: number;
} {
  const match = color?.match(
    /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/,
  );
  if (!match) {
    throw new Error(`Not an hsl() color: ${color}`);
  }
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

describe('getNodeColors', () => {
  describe('sequential ramp', () => {
    it('goes from a light tint at zero intensity to a dark shade at max', () => {
      const low = parseHsl(getNodeColors(0, 20, false).backgroundColor);
      const high = parseHsl(getNodeColors(20, 20, false).backgroundColor);
      // Light -> dark: lightness decreases, saturation increases as the metric
      // value climbs (a proper sequential scale, not a grey->color ramp).
      expect(high.l).toBeLessThan(low.l);
      expect(high.s).toBeGreaterThan(low.s);
    });

    it('increases intensity monotonically with the value', () => {
      const l0 = parseHsl(getNodeColors(0, 20, false).backgroundColor).l;
      const l5 = parseHsl(getNodeColors(5, 20, false).backgroundColor).l;
      const l10 = parseHsl(getNodeColors(10, 20, false).backgroundColor).l;
      const l20 = parseHsl(getNodeColors(20, 20, false).backgroundColor).l;
      expect(l0).toBeGreaterThanOrEqual(l5);
      expect(l5).toBeGreaterThanOrEqual(l10);
      expect(l10).toBeGreaterThanOrEqual(l20);
    });

    it('caps at the max value even when the value is higher', () => {
      expect(getNodeColors(30, 20, false)).toEqual(
        getNodeColors(20, 20, false),
      );
    });

    it('treats a non-positive max as zero intensity', () => {
      expect(getNodeColors(5, 0, false)).toEqual(getNodeColors(0, 20, false));
    });

    it('renders the border a fixed step darker than the fill', () => {
      const { backgroundColor, borderColor } = getNodeColors(10, 20, false);
      expect(parseHsl(borderColor).l).toBeLessThan(parseHsl(backgroundColor).l);
      expect(parseHsl(borderColor).h).toBe(parseHsl(backgroundColor).h);
    });
  });

  describe('selected state', () => {
    it('always uses a white border when selected, regardless of value', () => {
      expect(getNodeColors(0, 20, true).borderColor).toBe('white');
      expect(getNodeColors(10, 20, true).borderColor).toBe('white');
      expect(getNodeColors(30, 20, true).borderColor).toBe('white');
    });

    it('still computes the fill color when selected', () => {
      const selected = getNodeColors(10, 20, true);
      const unselected = getNodeColors(10, 20, false);
      expect(selected.backgroundColor).toBe(unselected.backgroundColor);
      expect(selected.borderColor).toBe('white');
    });
  });

  describe('return value structure', () => {
    it('returns valid hsl() strings for both colors', () => {
      const colors = getNodeColors(10, 20, false);
      expect(() => parseHsl(colors.backgroundColor)).not.toThrow();
      expect(() => parseHsl(colors.borderColor)).not.toThrow();
    });

    it('returns different colors for different inputs', () => {
      expect(getNodeColors(5, 20, false)).not.toEqual(
        getNodeColors(10, 20, false),
      );
    });
  });

  describe('metric hue', () => {
    it('defaults to the error-rate (red, hue 0) ramp', () => {
      expect(parseHsl(getNodeColors(10, 20, false).backgroundColor).h).toBe(
        SERVICE_MAP_METRIC_HUE.errorRate,
      );
    });

    it('uses each metric hue for both fill and border', () => {
      for (const metric of ['errorRate', 'latency', 'throughput'] as const) {
        const hue = SERVICE_MAP_METRIC_HUE[metric];
        const colors = getNodeColors(10, 20, false, metric);
        expect(parseHsl(colors.backgroundColor).h).toBe(hue);
        expect(parseHsl(colors.borderColor).h).toBe(hue);
      }
    });
  });
});

describe('getMetricGradientCss', () => {
  it('builds a left-to-right gradient from the ramp endpoints', () => {
    const css = getMetricGradientCss('errorRate');
    const stops = css.match(/hsl\([^)]+\)/g) ?? [];
    expect(css).toContain('linear-gradient(to right,');
    expect(stops).toHaveLength(2);
    // Low stop is lighter than the high stop, matching the node fills.
    expect(parseHsl(stops[0]).l).toBeGreaterThan(parseHsl(stops[1]).l);
  });

  it('uses the metric hue for both stops', () => {
    const stops =
      getMetricGradientCss('throughput').match(/hsl\([^)]+\)/g) ?? [];
    expect(parseHsl(stops[0]).h).toBe(SERVICE_MAP_METRIC_HUE.throughput);
    expect(parseHsl(stops[1]).h).toBe(SERVICE_MAP_METRIC_HUE.throughput);
  });
});

describe('getServiceMetricValue', () => {
  const makeService = (
    overrides: Partial<ServiceAggregation['incomingRequests']> = {},
    outgoingRequests = 0,
  ): ServiceAggregation => ({
    serviceName: 'svc',
    incomingRequests: {
      totalRequests: 100,
      errorCount: 5,
      errorPercentage: 5,
      p50: 10,
      p95: 40,
      p99: 90,
      hasLatency: true,
      ...overrides,
    },
    incomingRequestsByClient: new Map(),
    outgoingRequests,
  });

  it('returns the incoming error percentage for errorRate', () => {
    expect(
      getServiceMetricValue(
        makeService({ errorPercentage: 12.5 }),
        'errorRate',
      ),
    ).toBe(12.5);
  });

  it('returns the p95 latency for latency when available', () => {
    expect(getServiceMetricValue(makeService({ p95: 42 }), 'latency')).toBe(42);
  });

  it('returns 0 latency when the source has no duration data', () => {
    expect(
      getServiceMetricValue(
        makeService({ p95: 42, hasLatency: false }),
        'latency',
      ),
    ).toBe(0);
  });

  it('returns total incoming + outgoing volume for throughput', () => {
    expect(
      getServiceMetricValue(
        makeService({ totalRequests: 100 }, 25),
        'throughput',
      ),
    ).toBe(125);
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
