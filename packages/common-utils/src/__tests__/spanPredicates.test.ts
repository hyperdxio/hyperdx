import {
  errorStatusPredicateSql,
  serverSpanKindPredicateSql,
} from '@/core/spanPredicates';

describe('errorStatusPredicateSql', () => {
  it('matches both short and legacy error statuses case-insensitively', () => {
    expect(errorStatusPredicateSql('StatusCode')).toBe(
      "lower(StatusCode) IN ('error', 'status_code_error')",
    );
  });
});

describe('serverSpanKindPredicateSql', () => {
  it('matches both short and legacy server span kinds', () => {
    expect(serverSpanKindPredicateSql('SpanKind')).toBe(
      "SpanKind IN ('Server', 'SPAN_KIND_SERVER')",
    );
  });
});
