import type { TTraceSource } from '@hyperdx/common-utils/dist/types';

import { p95MsSql } from '@/knowledge/topology/sql';

// Only the fields p95MsSql reads.
const source = (durationPrecision?: number) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  ({ durationExpression: 'Duration', durationPrecision }) as TTraceSource;

describe('p95MsSql', () => {
  it('scales by the duration precision, defaulting to milliseconds', () => {
    expect(p95MsSql(source(9), 'd')).toBe('quantile(0.95)(d) * 0.000001');
    expect(p95MsSql(source(undefined), 'd')).toBe('quantile(0.95)(d) * 1');
  });
});
