import { ClickHouseError } from '@clickhouse/client-common';

import {
  isClientTimeoutOrAbortError,
  isQueryTimeoutError,
} from '@/tasks/checkAlerts/errors';

describe('checkAlerts errors', () => {
  describe('isQueryTimeoutError', () => {
    it('detects the ClickHouse client request timeout', () => {
      expect(isQueryTimeoutError(new Error('Timeout error.'))).toBe(true);
    });

    it('detects aborted requests', () => {
      expect(
        isQueryTimeoutError(new Error('The user aborted a request.')),
      ).toBe(true);
    });

    it('detects server-side TIMEOUT_EXCEEDED by type', () => {
      expect(
        isQueryTimeoutError(
          new ClickHouseError({
            code: '159',
            type: 'TIMEOUT_EXCEEDED',
            message: 'Timeout exceeded: elapsed 301.1 seconds',
          }),
        ),
      ).toBe(true);
    });

    it('detects server-side timeouts by code when the type is not populated', () => {
      expect(
        isQueryTimeoutError(
          new ClickHouseError({
            code: '159',
            type: '',
            message: 'Timeout exceeded',
          }),
        ),
      ).toBe(true);
    });

    it('detects TCP-level socket timeouts', () => {
      const err: NodeJS.ErrnoException = new Error('connect ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      expect(isQueryTimeoutError(err)).toBe(true);
    });

    it('does not classify other ClickHouse errors as timeouts', () => {
      expect(
        isQueryTimeoutError(
          new ClickHouseError({
            code: '60',
            type: 'UNKNOWN_TABLE',
            message: "Table default.foo doesn't exist",
          }),
        ),
      ).toBe(false);
      expect(isQueryTimeoutError(new Error('clickhouse kaput'))).toBe(false);
      expect(isQueryTimeoutError('Timeout error.')).toBe(false);
      expect(isQueryTimeoutError(undefined)).toBe(false);
    });
  });

  describe('isClientTimeoutOrAbortError', () => {
    it('only matches the client timeout/abort messages', () => {
      expect(isClientTimeoutOrAbortError(new Error('Timeout error.'))).toBe(
        true,
      );
      expect(
        isClientTimeoutOrAbortError(new Error('The user aborted a request.')),
      ).toBe(true);
      expect(
        isClientTimeoutOrAbortError(
          new ClickHouseError({
            code: '159',
            type: 'TIMEOUT_EXCEEDED',
            message: 'Timeout exceeded',
          }),
        ),
      ).toBe(false);
    });
  });
});
