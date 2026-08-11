import { getReverseSpanLinks } from '../SpansReverseLinksSubpanel';

const SPAN_ID_A = 'aaaaaaaaaaaa';
const SPAN_ID_B = 'bbbbbbbbbbbb';
const SPAN_ID_C = 'cccccccccccc';

const SPAN_A_WITH_LINKS = {
  SpanId: SPAN_ID_A,
  TraceId: 'trace-111',
  ServiceName: 'service-a',
  SpanName: 'GET /api/users',
  SpanKind: 'Server',
  __hdx_span_links: [
    {
      TraceId: 'trace-111',
      SpanId: SPAN_ID_B,
      TraceState: '',
      Attributes: { 'link.kind': 'child_of' },
    },
  ],
};

const SPAN_B_WITH_LINKS = {
  SpanId: SPAN_ID_B,
  TraceId: 'trace-111',
  ServiceName: 'service-b',
  SpanName: 'query-db',
  SpanKind: 'Internal',
  __hdx_span_links: [],
};

const SPAN_C_WITH_LINKS_TO_B = {
  SpanId: SPAN_ID_C,
  TraceId: 'trace-111',
  ServiceName: 'service-c',
  SpanName: 'POST /api/notify',
  SpanKind: 'Server',
  __hdx_span_links: [
    {
      TraceId: 'trace-111',
      SpanId: SPAN_ID_B,
      TraceState: '',
      Attributes: { 'link.kind': 'follows_from' },
    },
  ],
};

const SPAN_D_NO_LINKS = {
  SpanId: 'dddddddddddd',
  TraceId: 'trace-111',
  ServiceName: 'service-d',
  SpanName: 'health-check',
  SpanKind: 'Internal',
};

describe('getReverseSpanLinks', () => {
  it('returns [] for null/undefined rows', () => {
    expect(getReverseSpanLinks(null, SPAN_ID_B)).toEqual([]);
    expect(getReverseSpanLinks(undefined, SPAN_ID_B)).toEqual([]);
  });

  it('returns [] when currentSpanId is undefined', () => {
    expect(getReverseSpanLinks([SPAN_A_WITH_LINKS], undefined)).toEqual([]);
  });

  it('returns [] if no span links to the current span', () => {
    const result = getReverseSpanLinks(
      [SPAN_A_WITH_LINKS, SPAN_D_NO_LINKS],
      SPAN_ID_C,
    );
    expect(result).toEqual([]);
  });

  it('finds spans that link to the given SpanId', () => {
    const result = getReverseSpanLinks(
      [SPAN_A_WITH_LINKS, SPAN_B_WITH_LINKS, SPAN_C_WITH_LINKS_TO_B],
      SPAN_ID_B,
    );

    expect(result).toHaveLength(2);
    expect(result.map(r => r.SpanId)).toEqual(
      expect.arrayContaining([SPAN_ID_A, SPAN_ID_C]),
    );

    // Each reverse link should have Attributes describing the source span
    for (const link of result) {
      expect(link.Attributes).toMatchObject({
        'span.name': expect.any(String),
        'service.name': expect.any(String),
        'span.kind': expect.any(String),
      });
    }
  });

  it('handles spans with missing __hdx_span_links gracefully', () => {
    const result = getReverseSpanLinks(
      [SPAN_D_NO_LINKS, SPAN_B_WITH_LINKS],
      SPAN_ID_B,
    );
    expect(result).toHaveLength(0);
  });
});
