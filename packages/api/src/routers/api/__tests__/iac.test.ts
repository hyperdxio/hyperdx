import { IAC_MANIFEST_LIMIT } from '@hyperdx/common-utils/dist/iac';

import { capListing } from '@/routers/api/iac';

// The manifest endpoint fetches IAC_MANIFEST_LIMIT + 1 rows per type and uses
// the extra row to decide whether the listing was capped. Inverting the
// comparison, or dropping the slice, turns a partial export into one that
// looks complete — and the user only finds out when Terraform is missing
// resources. Unit-tested rather than integration-tested because seeding 1001
// documents per type is far more expensive than exercising the arithmetic.
describe('capListing', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('reports a listing shorter than the limit as complete', () => {
    const { items, truncated } = capListing(rows(3));

    expect(items).toHaveLength(3);
    expect(truncated).toBe(false);
  });

  it('reports a listing of exactly the limit as complete', () => {
    const { items, truncated } = capListing(rows(IAC_MANIFEST_LIMIT));

    expect(items).toHaveLength(IAC_MANIFEST_LIMIT);
    expect(truncated).toBe(false);
  });

  it('reports one row past the limit as truncated and drops the extra', () => {
    const { items, truncated } = capListing(rows(IAC_MANIFEST_LIMIT + 1));

    expect(items).toHaveLength(IAC_MANIFEST_LIMIT);
    expect(truncated).toBe(true);
    // The probe row must never reach the manifest.
    expect(items.at(-1)).toBe(IAC_MANIFEST_LIMIT - 1);
  });

  it('handles an empty listing', () => {
    expect(capListing([])).toEqual({ items: [], truncated: false });
  });
});
