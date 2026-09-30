/**
 * The `filters=` URL param carries dashboard filter selections in one of two
 * shapes: legacy, keyed by SQL expression, or variable-keyed by variable name.
 * These helpers are the one definition of that contract for the E2E suite.
 */
import { expect, type Page } from '@playwright/test';

export type FilterEntry =
  | { type: 'sql'; condition: string }
  | { type: 'variable'; name: string; values: string[] };

/** The raw, still-encoded `filters=` param. `null` when the param is absent. */
export const rawFiltersParam = (page: Page): string | null =>
  new URL(page.url()).searchParams.get('filters');

/** The `filters=` param, decoded. `null` when the param is absent. */
export const filtersParam = (page: Page): FilterEntry[] | null => {
  const raw = rawFiltersParam(page);
  if (raw === null) return null;
  return JSON.parse(decodeURIComponent(raw));
};

/** Wait for the param to settle on `expected` — nuqs writes it asynchronously. */
export const expectFiltersParam = async (
  page: Page,
  expected: FilterEntry[],
) => {
  await expect(async () => {
    expect(filtersParam(page)).toEqual(expected);
  }).toPass({ timeout: 10000 });
};
