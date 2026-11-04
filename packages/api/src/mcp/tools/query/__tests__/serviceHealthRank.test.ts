import { errorGroupKey } from '@/mcp/tools/query/serviceHealth/errorGroups';
import type { NewOperation } from '@/mcp/tools/query/serviceHealth/operations';
import {
  assessService,
  HEALTH_THRESHOLDS,
  type WindowStats,
} from '@/mcp/tools/query/serviceHealth/rank';
import {
  buildReport,
  errorGroupStatus,
  rankServices,
  selectTopErrors,
  topGroupsPerService,
} from '@/mcp/tools/query/serviceHealth/report';
import { comparisonWindow } from '@/mcp/tools/query/serviceHealth/schema';
import {
  errorTiming,
  serviceSummary,
} from '@/mcp/tools/query/serviceHealth/summary';

const stats = (s: Partial<WindowStats> = {}): WindowStats => ({
  requests: 1000,
  errors: 5,
  p50Ms: 50,
  p95Ms: 200,
  p99Ms: 300,
  ...s,
});

describe('assessService', () => {
  it('is healthy when nothing moved', () => {
    const a = assessService(stats(), stats(), 50);
    expect(a.status).toBe('healthy');
    expect(a.flags).toEqual([]);
  });

  it('ignores a doubled error rate below the absolute floor', () => {
    // 0.5% -> 1.0%: 2x, but only +0.5pp
    const a = assessService(stats({ errors: 10 }), stats({ errors: 5 }), 50);
    expect(a.flags).not.toContain('error_rate_up');
    expect(a.status).toBe('healthy');
  });

  it('flags error_rate_up at exactly the ratio and delta thresholds', () => {
    // 1% -> 2%: exactly 2x and +1pp
    const a = assessService(stats({ errors: 20 }), stats({ errors: 10 }), 50);
    expect(a.flags).toContain('error_rate_up');
    expect(a.status).toBe('degraded');
    expect(a.deltas.errorRateDeltaPp).toBe(1);
  });

  it('is critical when errors rose past the high error rate', () => {
    const a = assessService(stats({ errors: 80 }), stats({ errors: 5 }), 50);
    expect(a.flags).toEqual(
      expect.arrayContaining(['error_rate_up', 'high_error_rate']),
    );
    expect(a.status).toBe('critical');
  });

  it('marks a chronically high error rate degraded, not critical', () => {
    const a = assessService(stats({ errors: 80 }), stats({ errors: 80 }), 50);
    expect(a.flags).toEqual(['high_error_rate']);
    expect(a.status).toBe('degraded');
  });

  it('needs both the ratio and the ms delta for latency_up', () => {
    expect(
      assessService(stats({ p95Ms: 12 }), stats({ p95Ms: 4 }), 50).flags,
    ).not.toContain('latency_up');
    expect(
      assessService(
        stats({ p95Ms: 200 * HEALTH_THRESHOLDS.latencyRatio }),
        stats(),
        50,
      ).flags,
    ).toContain('latency_up');
  });

  it('flags traffic drops and spikes', () => {
    const drop = assessService(stats({ requests: 500 }), stats(), 50);
    expect(drop.flags).toContain('traffic_drop');
    expect(drop.status).toBe('degraded');

    const spike = assessService(stats({ requests: 3000 }), stats(), 50);
    expect(spike.flags).toContain('traffic_spike');
    expect(spike.status).toBe('healthy');
  });

  it('flags new and missing services', () => {
    const fresh = assessService(stats(), null, 50);
    expect(fresh.flags).toEqual(['new_service']);
    expect(fresh.status).toBe('healthy');

    const gone = assessService(null, stats(), 50);
    expect(gone.flags).toEqual(['missing_service']);
    expect(gone.status).toBe('degraded');
  });

  it('treats a handful of prior requests as no baseline', () => {
    const a = assessService(stats(), stats({ requests: 1, errors: 1 }), 50);
    expect(a.flags).toEqual(['new_service']);
    expect(a.status).toBe('healthy');
  });

  it('never flags services under minRequests in both windows', () => {
    const a = assessService(
      stats({ requests: 10, errors: 9 }),
      stats({ requests: 10, errors: 0 }),
      50,
    );
    expect(a.flags).toEqual(['low_volume']);
    expect(a.score).toBe(0);
    expect(a.status).toBe('healthy');
  });

  it('applies absolute rules only when comparisons are off', () => {
    const a = assessService(stats({ errors: 80 }), undefined, 50);
    expect(a.flags).toEqual(['high_error_rate']);
    expect(a.deltas.errorRateDeltaPp).toBeNull();
  });

  it('handles a zero comparison p95 without dividing by zero', () => {
    const a = assessService(stats(), stats({ p95Ms: 0 }), 50);
    expect(a.deltas.p95Ratio).toBeNull();
  });
});

describe('rankServices', () => {
  it('sorts by status, then by score with volume as a multiplier', () => {
    const cur = new Map([
      ['steady', stats()],
      ['small-regression', stats({ requests: 100, errors: 10 })],
      ['big-regression', stats({ requests: 100_000, errors: 10_000 })],
      ['broken', stats({ errors: 300 })],
    ]);
    const cmp = new Map([
      ['steady', stats()],
      ['small-regression', stats({ requests: 100, errors: 0 })],
      ['big-regression', stats({ requests: 100_000, errors: 0 })],
      ['broken', stats()],
    ]);
    expect(rankServices(cur, cmp, 50).map(r => r.service)).toEqual([
      'broken',
      'big-regression',
      'small-regression',
      'steady',
    ]);
  });

  it('includes services seen in only one window', () => {
    const ranked = rankServices(
      new Map([['a', stats()]]),
      new Map([['b', stats()]]),
      50,
    );
    expect(ranked.map(r => [r.service, r.assessment.flags])).toEqual([
      ['b', ['missing_service']],
      ['a', ['new_service']],
    ]);
  });
});

describe('topGroupsPerService', () => {
  it('keeps the first N groups per service', () => {
    const g = (service: string, count: number) => ({
      service,
      group: { SpanName: `op-${count}` },
      count,
    });
    const out = topGroupsPerService(
      [g('a', 9), g('b', 8), g('a', 7), g('a', 6)],
      2,
    );
    expect(out.get('a')?.map(x => x.count)).toEqual([9, 7]);
    expect(out.get('b')?.map(x => x.count)).toEqual([8]);
  });
});

describe('comparisonWindow', () => {
  const current = {
    start: new Date('2026-10-16T10:00:00Z'),
    end: new Date('2026-10-16T11:00:00Z'),
  };

  it.each([
    ['yesterday', '2026-10-15T10:00:00.000Z', '2026-10-15T11:00:00.000Z'],
    ['last_week', '2026-10-09T10:00:00.000Z', '2026-10-09T11:00:00.000Z'],
    ['previous_period', '2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z'],
  ] as const)('%s', (mode, start, end) => {
    const w = comparisonWindow(current, mode);
    expect(w?.start.toISOString()).toBe(start);
    expect(w?.end.toISOString()).toBe(end);
  });

  it('returns null for none', () => {
    expect(comparisonWindow(current, 'none')).toBeNull();
  });
});

describe('error group selection', () => {
  const g = (msg: string, count: number) => ({
    service: 'svc',
    group: { StatusMessage: msg },
    count,
  });
  const counts = (entries: [string, number][]) =>
    new Map(entries.map(([msg, n]) => [errorGroupKey(g(msg, 0)), n]));

  it('labels growth only when it is beyond random variation', () => {
    expect(errorGroupStatus(5, 0)).toBe('new');
    expect(errorGroupStatus(13, 5)).toBe('existing');
    expect(errorGroupStatus(4060, 170)).toBe('growing');
  });

  it('lists new and growing groups before larger steady ones', () => {
    const picked = selectTopErrors(
      [g('steady', 500), g('growing', 300), g('new', 40), g('tiny-new', 2)],
      counts([
        ['steady', 480],
        ['growing', 20],
      ]),
      3,
    );
    expect(picked.map(x => x.group.StatusMessage)).toEqual([
      'growing',
      'new',
      'steady',
    ]);
  });

  it('does not promote new groups that a new operation explains', () => {
    const picked = selectTopErrors(
      [g('steady', 500), g('on-new-endpoint', 40), g('new', 30)],
      counts([['steady', 480]]),
      2,
      x => x.group.StatusMessage === 'on-new-endpoint',
    );
    expect(picked.map(x => x.group.StatusMessage)).toEqual(['new', 'steady']);
  });

  it('keeps count order without a comparison', () => {
    const picked = selectTopErrors([g('a', 9), g('b', 5), g('c', 1)], null, 2);
    expect(picked.map(x => x.group.StatusMessage)).toEqual(['a', 'b']);
  });
});

describe('buildReport', () => {
  it('lifts a service with a new error group into the top N', () => {
    const ranked = rankServices(
      new Map([
        ['busy', stats({ requests: 100_000, errors: 600 })],
        ['quiet', stats({ requests: 1000, errors: 5 })],
      ]),
      new Map([
        ['busy', stats({ requests: 100_000, errors: 500 })],
        ['quiet', stats({ requests: 1000, errors: 5 })],
      ]),
      50,
    );
    expect(ranked.map(r => r.service)).toEqual(['busy', 'quiet']);
    const novel = {
      service: 'quiet',
      group: { SpanName: 'POST /pay', StatusMessage: 'payment unavailable' },
      count: 8,
    };
    const report = buildReport({
      ranked,
      current: { start: new Date(0), end: new Date(600_000) },
      comparison: { start: new Date(-600_000), end: new Date(0) },
      comparisonMode: 'previous_period',
      spanKind: 'server',
      topN: 1,
      errorGroupBy: ['SpanName', 'StatusMessage'],
      currentErrors: new Map([['quiet', [novel]]]),
      comparisonErrorCounts: new Map(),
      newOperations: new Map(),
      spanNameKey: 'SpanName',
    });
    expect(report.services.map(s => s.service)).toEqual(['quiet']);
    expect(report.services[0].flags).toContain('new_errors');
  });

  const reportFor = (
    cur: WindowStats,
    cmp: WindowStats,
    newOperations: Map<string, NewOperation[]> = new Map(),
  ) =>
    buildReport({
      ranked: rankServices(
        new Map([['svc', cur]]),
        new Map([['svc', cmp]]),
        50,
      ),
      current: { start: new Date(0), end: new Date(600_000) },
      comparison: { start: new Date(-600_000), end: new Date(0) },
      comparisonMode: 'previous_period',
      spanKind: 'server',
      topN: 5,
      errorGroupBy: ['SpanName', 'StatusMessage'],
      currentErrors: new Map([
        [
          'svc',
          [
            {
              service: 'svc',
              group: { SpanName: 'GET /v2', StatusMessage: 'x' },
              count: 20,
            },
          ],
        ],
      ]),
      comparisonErrorCounts: new Map(),
      newOperations,
      spanNameKey: 'SpanName',
    }).services[0];

  it('does not call errors on a brand-new operation new errors', () => {
    const svc = reportFor(
      stats(),
      stats(),
      new Map([
        ['svc', [{ operation: 'GET /v2', requests: 100, shareOfService: 0.1 }]],
      ]),
    );
    expect(svc.flags).not.toContain('new_errors');
    expect(svc.topErrors[0].status).toBe('new_operation');
  });

  it('does not call errors new when the service has no baseline', () => {
    const svc = reportFor(stats(), stats({ requests: 1, errors: 0 }));
    expect(svc.flags).toEqual(['new_service']);
    expect(svc.summary).not.toMatch(/New or growing errors/);
    expect(svc.topErrors[0]).not.toHaveProperty('status');
  });
});

describe('errorTiming', () => {
  const window = {
    start: new Date('2026-10-20T17:05:00Z'),
    end: new Date('2026-10-20T18:05:00Z'),
  };
  const at = (hhmm: string) => Date.parse(`2026-10-20T${hhmm}:00Z`);
  const group = (first: string, last: string) => ({
    service: 'svc',
    group: { SpanName: 'POST /x' },
    count: 30,
    firstSeenMs: at(first),
    lastSeenMs: at(last),
  });

  it('calls a group still firing at the window end ongoing', () => {
    expect(errorTiming(group('17:30', '18:04'), window).pattern).toBe(
      'ongoing',
    );
  });

  it('calls errors spread across the window spread, not a burst', () => {
    // 52 minutes of errors, last one 7 minutes before the window end.
    expect(errorTiming(group('17:06', '17:58'), window).pattern).toBe('spread');
  });

  it('calls a short spike that ended a burst', () => {
    expect(errorTiming(group('17:20', '17:21'), window).pattern).toBe('burst');
  });

  it('only calls bursts transient in the summary', () => {
    const summary = (g: ReturnType<typeof group>) =>
      serviceSummary({
        current: stats(),
        comparison: stats(),
        assessment: assessService(stats(), stats(), 50),
        changedErrors: [g],
        newOperations: [],
        window,
        comparisonMode: 'yesterday',
      });
    const trickle = summary(group('17:06', '17:58'));
    expect(trickle).toMatch(/spread across 17:06-17:58 UTC, none since 17:58/);
    expect(trickle).not.toMatch(/transient/);
    expect(trickle).toMatch(/check clickstack_timeseries/);
    expect(summary(group('17:20', '17:21'))).toMatch(/transient/);
  });
});
