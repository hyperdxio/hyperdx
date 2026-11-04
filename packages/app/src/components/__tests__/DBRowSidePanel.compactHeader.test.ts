import {
  getHeaderHighlightExpressions,
  isSpanNameShownInTitle,
} from '@/components/DBRowSidePanel';
import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';

describe('isSpanNameShownInTitle', () => {
  const trace = makeTraceSource();

  it('is true when the lone title crumb is a short span name', () => {
    expect(
      isSpanNameShownInTitle(trace, 'GET /checkout', ['GET /checkout']),
    ).toBe(true);
  });

  it('allows names up to 40 characters', () => {
    const name = 'x'.repeat(40);
    expect(isSpanNameShownInTitle(trace, name, [name])).toBe(true);
  });

  it('keeps the body for longer names the title can cut off', () => {
    const name = 'x'.repeat(41);
    expect(isSpanNameShownInTitle(trace, name, [name])).toBe(false);
  });

  it('keeps the body in a breadcrumb trail, where crumbs share the row', () => {
    // A hop between two spans with the same name is still a trail.
    expect(
      isSpanNameShownInTitle(trace, 'GET /checkout', [
        'GET /checkout',
        'GET /checkout',
      ]),
    ).toBe(false);
  });

  it('keeps the body when the title is not the span name', () => {
    expect(isSpanNameShownInTitle(trace, 'GET /checkout', ['Trace'])).toBe(
      false,
    );
  });

  it('keeps the body when the span has no body value', () => {
    expect(isSpanNameShownInTitle(trace, undefined, ['Trace'])).toBe(false);
  });

  it('keeps the body on log panels', () => {
    expect(
      isSpanNameShownInTitle(makeLogSource(), 'a log line', ['a log line']),
    ).toBe(false);
  });
});

describe('getHeaderHighlightExpressions', () => {
  it('does not repeat the service as a chip on trace panels', () => {
    expect(getHeaderHighlightExpressions(makeTraceSource())).toEqual([]);
  });

  it('still highlights the service on log panels', () => {
    expect(getHeaderHighlightExpressions(makeLogSource())).toEqual([
      { sqlExpression: 'ServiceName' },
    ]);
  });

  it('keeps highlights configured on the source', () => {
    const highlight = { sqlExpression: "SpanAttributes['http.method']" };
    expect(
      getHeaderHighlightExpressions(
        makeTraceSource({ highlightedRowAttributeExpressions: [highlight] }),
      ),
    ).toEqual([highlight]);
  });
});
