import { z } from 'zod';

import { decodeCursor, encodeCursor } from '@/utils/pagination';

const payloadSchema = z.object({
  n: z.string().nullable(),
  id: z.string(),
});

describe('cursor encoding', () => {
  it('round-trips a payload', () => {
    const payload = { n: 'Checkout errors', id: 'abc123' };
    expect(decodeCursor(encodeCursor(payload), payloadSchema)).toEqual(payload);
  });

  it('round-trips null and unicode values', () => {
    const payload = { n: null, id: 'µ-naïve/id+1' };
    expect(decodeCursor(encodeCursor(payload), payloadSchema)).toEqual(payload);
  });

  it('emits a URL-safe cursor', () => {
    // A cursor travels in a query string, so it must survive unescaped.
    const encoded = encodeCursor({ n: 'a+b/c?d&e=f', id: 'x' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it('decodes standard base64 as well as base64url', () => {
    // Cursors issued before the encoding switched are still in flight.
    const payload = { n: 'a+b/c', id: 'x' };
    const standard = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64',
    );
    expect(decodeCursor(standard, payloadSchema)).toEqual(payload);
  });

  it.each([
    ['non-base64 input', 'not a cursor!'],
    ['an empty string', ''],
    ['base64 of invalid JSON', Buffer.from('not json').toString('base64url')],
  ])('returns null for %s', (_label, raw) => {
    expect(decodeCursor(raw, payloadSchema)).toBeNull();
  });

  it('returns null for a payload the schema rejects', () => {
    expect(decodeCursor(encodeCursor({ id: 'x' }), payloadSchema)).toBeNull();
    expect(
      decodeCursor(encodeCursor({ n: 1, id: 'x' }), payloadSchema),
    ).toBeNull();
  });
});
