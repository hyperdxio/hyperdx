import {
  errorStatusPredicateSql,
  isErrorStatusCode,
  serverSpanKindPredicateSql,
} from '@/core/spanPredicates';

describe('errorStatusPredicateSql', () => {
  it('matches both short and legacy error statuses case-insensitively', () => {
    expect(errorStatusPredicateSql('StatusCode')).toBe(
      "lower(StatusCode) IN ('error', 'status_code_error')",
    );
  });
});

describe('isErrorStatusCode', () => {
  it.each([
    'Error',
    'ERROR',
    'error',
    'STATUS_CODE_ERROR',
    'status_code_error',
    'Status_Code_Error',
  ])('treats %s as an error', status => {
    expect(isErrorStatusCode(status)).toBe(true);
  });

  it.each([
    'Ok',
    'OK',
    'STATUS_CODE_OK',
    'Unset',
    'STATUS_CODE_UNSET',
    'erroring',
    '',
    undefined,
    null,
  ])('does not treat %s as an error', status => {
    expect(isErrorStatusCode(status)).toBe(false);
  });
});

describe('serverSpanKindPredicateSql', () => {
  it('matches both short and legacy server span kinds', () => {
    expect(serverSpanKindPredicateSql('SpanKind')).toBe(
      "SpanKind IN ('Server', 'SPAN_KIND_SERVER')",
    );
  });
});
