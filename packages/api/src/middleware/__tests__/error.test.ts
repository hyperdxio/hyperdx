import type { Request, Response } from 'express';

// --- mocks (hoisted; names must be prefixed with `mock`) ---
const mockCounterAdd = jest.fn();
const mockRecordException = jest.fn();
const mockSetAttribute = jest.fn();
const mockLogger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock('@hyperdx/node-opentelemetry', () => ({
  recordException: (...args: unknown[]) => mockRecordException(...args),
}));
jest.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: () => ({ setAttribute: mockSetAttribute }) },
}));
jest.mock('@/config', () => ({ IS_PROD: false }));
jest.mock('@/utils/instrumentation', () => ({
  getCounter: () => ({ add: (...args: unknown[]) => mockCounterAdd(...args) }),
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
}));

import { appErrorHandler } from '@/middleware/error';
import { Api404Error } from '@/utils/errors';

const invoke = (err: unknown): Response => {
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  appErrorHandler(err as any, {} as Request, res, jest.fn());
  return res;
};

const lastCounterAttrs = () =>
  mockCounterAdd.mock.calls[mockCounterAdd.mock.calls.length - 1][1];

describe('appErrorHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('client disconnect (body-parser request.aborted)', () => {
    const abortErr = Object.assign(new Error('request aborted'), {
      type: 'request.aborted',
      statusCode: 400,
      received: 5,
      expected: 10,
    });

    it('classifies as operational and logs at debug, not error', () => {
      invoke(abortErr);
      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(lastCounterAttrs()).toMatchObject({
        operational: true,
        error_type: 'request.aborted',
      });
    });

    it('skips recordException (benign background noise)', () => {
      invoke(abortErr);
      expect(mockRecordException).not.toHaveBeenCalled();
    });

    it('records how far the upload got on the span', () => {
      invoke(abortErr);
      expect(mockSetAttribute).toHaveBeenCalledWith(
        'http.request.received_bytes',
        5,
      );
      expect(mockSetAttribute).toHaveBeenCalledWith(
        'http.request.expected_bytes',
        10,
      );
    });
  });

  describe('outbound ECONNABORTED (e.g. axios timeout) is NOT a disconnect', () => {
    // No body-parser `type` — must not be silently downgraded.
    const timeoutErr = Object.assign(new Error('timeout of 1000ms exceeded'), {
      code: 'ECONNABORTED',
    });

    it('stays a non-operational error: logged at error, recorded', () => {
      invoke(timeoutErr);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockRecordException).toHaveBeenCalledTimes(1);
      expect(lastCounterAttrs()).toMatchObject({ operational: false });
    });
  });

  describe('error_type label boundedness', () => {
    it('uses the bounded class name, not the interpolated BaseError message', () => {
      invoke(new Api404Error(`Team not found for user ${'abc-123'}`));
      // Operational (Api4xx) -> warn. The label is the bounded class name —
      // NOT the interpolated message. BaseError's setPrototypeOf collapses
      // subclasses to "BaseError"; granularity comes from status_code (404).
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(lastCounterAttrs()).toMatchObject({
        error_type: 'BaseError',
        status_code: 404,
      });
    });
  });
});
