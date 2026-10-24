import { buildSessionEventFilters } from '@/utils/sessions';

const traceSource = { spanNameExpression: 'SpanName' };

describe('buildSessionEventFilters', () => {
  const filters = buildSessionEventFilters({
    traceSource,
    sessionId: 'abc',
    sessionIdKey: 'session.id',
  });

  it('highlights failed requests from either HTTP key set', () => {
    expect(filters.highlighted[0]).toEqual({
      type: 'lucene',
      condition: 'SpanAttributes.session.id:"abc"',
    });
    expect(filters.highlighted[1].condition).toContain(
      'SpanAttributes.http.status_code:>299',
    );
    expect(filters.highlighted[1].condition).toContain(
      'SpanAttributes.http.response.status_code:>299',
    );
    expect(filters.highlighted[1].condition).toContain(
      'SpanAttributes.error.type:*',
    );
  });

  it('lists every request, including ones without a status code', () => {
    expect(filters.all[0]).toEqual(filters.highlighted[0]);
    expect(filters.all[1].condition).toContain(
      'SpanAttributes.http.status_code:*',
    );
    expect(filters.all[1].condition).toContain('SpanAttributes.url.full:*');
  });
});
