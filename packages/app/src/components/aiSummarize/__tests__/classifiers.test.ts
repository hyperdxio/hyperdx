import { isErrorEvent, isWarnEvent, normalizeSeverity } from '../classifiers';

describe('isErrorEvent', () => {
  it('returns true for error severity', () => {
    expect(isErrorEvent({ severity: 'error' })).toBe(true);
    expect(isErrorEvent({ severity: 'ERROR' })).toBe(true);
    expect(isErrorEvent({ severity: 'fatal' })).toBe(true);
    expect(isErrorEvent({ severity: 'critical' })).toBe(true);
  });

  it('returns true for OTel status code variants', () => {
    expect(isErrorEvent({ statusCode: 'Error' })).toBe(true);
    expect(isErrorEvent({ statusCode: 'STATUS_CODE_ERROR' })).toBe(true);
    expect(isErrorEvent({ statusCode: 2 })).toBe(true);
  });

  it('returns true for HTTP 5xx', () => {
    expect(isErrorEvent({ httpStatus: 500 })).toBe(true);
    expect(isErrorEvent({ httpStatus: '503' })).toBe(true);
  });

  it('returns true when an exception is present', () => {
    expect(isErrorEvent({ exceptionType: 'NullPointerException' })).toBe(true);
    expect(isErrorEvent({ exceptionMessage: 'obj is null' })).toBe(true);
  });

  it('falls back to body regex for missing/wrong severity', () => {
    expect(
      isErrorEvent({ severity: 'info', body: 'Uncaught exception: boom' }),
    ).toBe(true);
    expect(isErrorEvent({ body: 'panic: runtime error' })).toBe(true);
  });

  it('does not match substring noise like "errorless"', () => {
    expect(isErrorEvent({ body: 'handled errorlessly' })).toBe(false);
  });

  it('returns false for healthy events', () => {
    expect(isErrorEvent({ severity: 'info', body: 'request completed' })).toBe(
      false,
    );
    expect(isErrorEvent({ httpStatus: 200 })).toBe(false);
    expect(isErrorEvent({})).toBe(false);
  });
});

describe('isWarnEvent', () => {
  it('returns true for warn severity', () => {
    expect(isWarnEvent({ severity: 'warn' })).toBe(true);
    expect(isWarnEvent({ severity: 'warning' })).toBe(true);
  });

  it('returns true for HTTP 4xx', () => {
    expect(isWarnEvent({ httpStatus: 404 })).toBe(true);
  });

  it('prefers error classification over warn', () => {
    // severity warn but body indicates real error — error wins
    expect(
      isWarnEvent({ severity: 'warn', body: 'Uncaught exception: nope' }),
    ).toBe(false);
    expect(
      isErrorEvent({ severity: 'warn', body: 'Uncaught exception: nope' }),
    ).toBe(true);
  });
});

describe('normalizeSeverity', () => {
  it('normalizes severity variants to stable tokens', () => {
    expect(normalizeSeverity({ severity: 'ERROR' })).toBe('error');
    expect(normalizeSeverity({ severity: 'fatal' })).toBe('error');
    expect(normalizeSeverity({ severity: 'warn' })).toBe('warn');
    expect(normalizeSeverity({ severity: 'Notice' })).toBe('info');
    expect(normalizeSeverity({ severity: 'trace' })).toBe('debug');
  });

  it('returns error when body suggests error despite benign severity', () => {
    expect(
      normalizeSeverity({ severity: 'info', body: 'panic: failed to bind' }),
    ).toBe('error');
  });
});
