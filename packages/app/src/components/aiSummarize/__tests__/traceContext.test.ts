import { buildTraceContext, TraceSpan } from '../traceContext';

function mkSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    Body: 'span.op',
    ServiceName: 'svc',
    Duration: 0.01, // 10ms
    StatusCode: 'Unset',
    ...overrides,
  };
}

describe('buildTraceContext', () => {
  it('returns empty string for no spans', () => {
    expect(buildTraceContext([])).toBe('');
  });

  it('includes header with totals and longest span', () => {
    const spans = [mkSpan({ Duration: 0.1 }), mkSpan({ Duration: 0.5 })];
    const result = buildTraceContext(spans);
    expect(result).toContain('2 spans');
    expect(result).toContain('0 errors');
    expect(result).toContain('500ms longest span');
  });

  it('groups spans by name with count, sum, p50', () => {
    const spans = [
      mkSpan({ Body: 'mongodb.create', Duration: 0.01 }),
      mkSpan({ Body: 'mongodb.create', Duration: 0.02 }),
      mkSpan({ Body: 'mongodb.create', Duration: 0.03 }),
      mkSpan({ Body: 'tcp.connect', Duration: 0.001 }),
    ];
    const result = buildTraceContext(spans);
    expect(result).toContain('mongodb.create: 3x');
    expect(result).toContain('tcp.connect: 1x');
    expect(result).toContain('sum=60ms');
    expect(result).toContain('p50=20ms');
  });

  it('prioritizes error groups in the sorted list', () => {
    // create more healthy spans than error spans — error group should still
    // appear first
    const spans = [
      ...Array.from({ length: 10 }, () =>
        mkSpan({ Body: 'healthy.op', Duration: 0.001 }),
      ),
      mkSpan({ Body: 'failed.op', StatusCode: 'Error' }),
    ];
    const result = buildTraceContext(spans);
    const failedIdx = result.indexOf('failed.op');
    const healthyIdx = result.indexOf('healthy.op');
    expect(failedIdx).toBeGreaterThan(-1);
    expect(healthyIdx).toBeGreaterThan(-1);
    expect(failedIdx).toBeLessThan(healthyIdx);
  });

  it('includes error spans section with exception details', () => {
    const spans = [
      mkSpan({
        Body: 'http.request',
        StatusCode: 'Error',
        SpanAttributes: {
          'exception.message': 'Connection refused',
          'http.status_code': 500,
        },
      }),
    ];
    const result = buildTraceContext(spans);
    expect(result).toContain('Error spans:');
    expect(result).toContain('Connection refused');
  });

  it('handles non-string SpanAttributes without crashing', () => {
    // http.status_code is often a number
    const spans = [
      mkSpan({
        StatusCode: 'Error',
        SpanAttributes: {
          'http.status_code': 503,
          'some.weird.attr': { nested: true },
        },
      }),
    ];
    expect(() => buildTraceContext(spans)).not.toThrow();
  });

  it('classifies errors via body even with no explicit status', () => {
    // log-style span with missing StatusCode but an exception in body
    const spans = [
      mkSpan({ Body: 'Uncaught exception: TypeError', StatusCode: undefined }),
    ];
    const result = buildTraceContext(spans);
    expect(result).toContain('1 errors');
  });

  it('truncates output to the max char budget', () => {
    // craft spans where each row exceeds 300 chars so the 15-group cap still
    // blows past 4KB and forces the final truncation
    const longName = (i: number) => `span.${'x'.repeat(300)}.${i}`;
    const spans: TraceSpan[] = [];
    for (let i = 0; i < 30; i++) {
      spans.push(
        mkSpan({
          Body: longName(i),
          StatusCode: 'Error',
          SpanAttributes: {
            'exception.message': `error: ` + 'y'.repeat(200),
          },
        }),
      );
    }
    const result = buildTraceContext(spans);
    expect(result.length).toBeLessThanOrEqual(4000);
    expect(result).toContain('(truncated)');
  });

  it('caps error spans section at 10 items', () => {
    const spans = Array.from({ length: 25 }, (_, i) =>
      mkSpan({ Body: `err.${i}`, StatusCode: 'Error' }),
    );
    const result = buildTraceContext(spans);
    expect(result).toContain('... and 15 more errors');
  });
});
