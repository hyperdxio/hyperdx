// Mock heavy dependencies that break in unit-test context (no ClickHouse/Mongo)
jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({}));
jest.mock('@/utils/trimToolResponse', () => ({
  trimToolResponse: (data: unknown) => ({ data, isTrimmed: false }),
}));

import { decodeCursor, encodeCursor } from '@/mcp/tools/sources/listMetrics';

describe('listMetrics cursor', () => {
  describe('encodeCursor / decodeCursor round-trip', () => {
    it('round-trips a gauge cursor', () => {
      const payload = { kind: 'gauge' as const, lastName: 'system.cpu.idle' };
      const encoded = encodeCursor(payload);
      expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64
      expect(decodeCursor(encoded)).toEqual(payload);
    });

    it('round-trips a sum cursor', () => {
      const payload = {
        kind: 'sum' as const,
        lastName: 'http.server.request.count',
      };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('round-trips a histogram cursor', () => {
      const payload = {
        kind: 'histogram' as const,
        lastName: 'http.server.request.duration',
      };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('round-trips metric names with dots, dashes, and unicode', () => {
      const payload = {
        kind: 'gauge' as const,
        lastName: 'system.cpu.utilization-µ.naïve',
      };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });
  });

  describe('decodeCursor rejection cases', () => {
    it('returns null for non-base64 input', () => {
      expect(decodeCursor('not-base64!')).toBeNull();
    });

    it('returns null for base64 of invalid JSON', () => {
      const garbage = Buffer.from('not json').toString('base64');
      expect(decodeCursor(garbage)).toBeNull();
    });

    it('returns null when kind is missing', () => {
      const malformed = Buffer.from(JSON.stringify({ lastName: 'x' })).toString(
        'base64',
      );
      expect(decodeCursor(malformed)).toBeNull();
    });

    it('returns null when lastName is missing', () => {
      const malformed = Buffer.from(JSON.stringify({ kind: 'gauge' })).toString(
        'base64',
      );
      expect(decodeCursor(malformed)).toBeNull();
    });

    it('returns null when kind is not a queryable metric kind', () => {
      const summaryCursor = Buffer.from(
        JSON.stringify({ kind: 'summary', lastName: 'x' }),
      ).toString('base64');
      expect(decodeCursor(summaryCursor)).toBeNull();

      const expHistCursor = Buffer.from(
        JSON.stringify({ kind: 'exponential histogram', lastName: 'x' }),
      ).toString('base64');
      expect(decodeCursor(expHistCursor)).toBeNull();

      const bogusCursor = Buffer.from(
        JSON.stringify({ kind: 'bogus', lastName: 'x' }),
      ).toString('base64');
      expect(decodeCursor(bogusCursor)).toBeNull();
    });

    it('returns null when kind has the wrong type', () => {
      const malformed = Buffer.from(
        JSON.stringify({ kind: 1, lastName: 'x' }),
      ).toString('base64');
      expect(decodeCursor(malformed)).toBeNull();
    });

    it('returns null when lastName has the wrong type', () => {
      const malformed = Buffer.from(
        JSON.stringify({ kind: 'gauge', lastName: 42 }),
      ).toString('base64');
      expect(decodeCursor(malformed)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });
  });
});
