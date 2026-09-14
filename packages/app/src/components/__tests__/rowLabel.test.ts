import { TSource } from '@hyperdx/common-utils/dist/types';

import { getTableRowLabel } from '@/components/rowLabel';

const asSource = (source: Record<string, unknown>) =>
  source as unknown as TSource;

const LOG_SOURCE = asSource({ kind: 'log', bodyExpression: 'Body' });
const TRACE_SOURCE = asSource({
  kind: 'trace',
  spanNameExpression: 'SpanName',
});

describe('getTableRowLabel', () => {
  it("reads the body from the source's own expression, as the table selects it", () => {
    expect(getTableRowLabel(LOG_SOURCE, { Body: 'upstream timeout' })).toBe(
      'upstream timeout',
    );
    expect(getTableRowLabel(TRACE_SOURCE, { SpanName: 'GET /checkout' })).toBe(
      'GET /checkout',
    );
  });

  it('serializes a body that is not a string', () => {
    expect(getTableRowLabel(LOG_SOURCE, { Body: { msg: 'hi' } })).toBe(
      '{"msg":"hi"}',
    );
  });

  it('names the kind of event when the row carries no body', () => {
    expect(getTableRowLabel(LOG_SOURCE, { ServiceName: 'cart' })).toBe('Log');
    expect(getTableRowLabel(TRACE_SOURCE, {})).toBe('Span');
    expect(getTableRowLabel(LOG_SOURCE, undefined)).toBe('Log');
  });

  it('names the kind of event for an empty body', () => {
    expect(getTableRowLabel(LOG_SOURCE, { Body: '' })).toBe('Log');
  });
});
