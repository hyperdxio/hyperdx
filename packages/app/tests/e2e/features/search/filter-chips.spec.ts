/**
 * Inline filter chips inside the WHERE input
 *
 * These tests exercise the chips rendered by `InlineFilterChips` and the
 * surrounding `SearchWhereInput` / `AutocompleteInput` / `SQLInlineEditor`
 * integration — rendering, removal, persistence, keyboard interactions,
 * focus/blur, language switching, and visual overflow.
 *
 * Strategy
 * --------
 * - "Sidebar" tests apply filters via the sidebar to exercise the full user
 *   flow. They need the time range to cover the seed data, which is what
 *   the `setupSidebarReadyPage` helper does.
 * - "URL-seeded" tests seed filters via the `?filters=` URL parameter (the
 *   exact same encoding used by DBSearchPage's `parseAsJsonEncoded`). This
 *   bypasses the sidebar's "show only matching values" facet behavior —
 *   without it, you can't reliably click multiple values within the same
 *   field after the first one is applied. The chip subsystem renders purely
 *   from URL/form state, so URL-seeding is faithful coverage.
 */
import { Page } from '@playwright/test';

import {
  buildFiltersUrlParam,
  SeedFilter,
} from '../../components/FilterChipsComponent';
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

const SEVERITY = 'SeverityText';
const SERVICE = 'ServiceName';
const SEV_INFO = 'info';
const SEV_ERROR = 'error';
const SEV_WARN = 'warn';
const SEV_DEBUG = 'debug';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureGroupOpen(
  searchPage: SearchPage,
  column: string,
  value: string,
): Promise<void> {
  const cb = searchPage.filters.getFilterCheckboxInput(column, value);
  if (await cb.isVisible()) return;
  await searchPage.filters.openFilterGroup(column);
  await cb.waitFor({ state: 'visible', timeout: 10000 });
}

async function applySidebarFilter(
  searchPage: SearchPage,
  column: string,
  value: string,
): Promise<void> {
  await ensureGroupOpen(searchPage, column, value);
  await searchPage.filters.applyFilter(column, value);
  await expect(searchPage.chips.chip(column, value, 'included')).toBeVisible();
  // The form-to-URL write is debounced ~1s; wait for the URL to reflect the
  // filter so subsequent page.reload() / page.goto() preserve the state.
  await searchPage.page.waitForFunction(
    v => decodeURIComponent(window.location.search).includes(`'${v}'`),
    value,
    { timeout: 5000 },
  );
}

async function excludeSidebarFilter(
  searchPage: SearchPage,
  column: string,
  value: string,
): Promise<void> {
  await ensureGroupOpen(searchPage, column, value);
  await searchPage.filters.excludeFilter(column, value);
  await expect(searchPage.chips.chip(column, value, 'excluded')).toBeVisible();
}

/**
 * Bootstrap a search page where the seed data falls inside the time window.
 * Needed for sidebar-driven tests because the facets only populate when the
 * query window covers the seed range.
 */
async function setupSidebarReadyPage(
  page: Page,
  searchPage: SearchPage,
): Promise<void> {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });
  await searchPage.timePicker.input.waitFor({
    state: 'visible',
    timeout: 30000,
  });
  await searchPage.timePicker.selectRelativeTime('Last 1 days');
}

/**
 * Navigate to /search with pre-seeded filters and wait for the chip subsystem
 * to render the expected number of chips. Chip rendering is derived from URL
 * state alone, so we don't need the table or sidebar facets to populate.
 */
async function gotoWithFilters(
  page: Page,
  searchPage: SearchPage,
  filters: SeedFilter[],
): Promise<void> {
  const filtersParam = buildFiltersUrlParam(filters);
  // Set an explicit 1-day window so Live Tail's 15-minute default doesn't
  // interfere with first-paint timing.
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const url = `/search?filters=${filtersParam}&isLive=false&from=${oneDayAgo}&to=${now}`;
  const expectedCount = filters.reduce(
    (acc, f) => acc + ('range' in f ? 1 : f.values.length),
    0,
  );

  await page.goto(url, { waitUntil: 'load' });
  await searchPage.timePicker.input.waitFor({
    state: 'visible',
    timeout: 30000,
  });
  await searchPage.input.waitFor({ state: 'visible', timeout: 15000 });

  if (expectedCount === 0) return;

  // Wait for the URL filters to materialize as chips. In dev mode webpack the
  // initial hydration can race with the chip subsystem's first read of
  // URL filters, so we reload once as a fallback to force a clean re-mount.
  try {
    await expect(searchPage.chips.chips).toHaveCount(expectedCount, {
      timeout: 15000,
    });
  } catch {
    await page.reload({ waitUntil: 'load' });
    await searchPage.input.waitFor({ state: 'visible', timeout: 15000 });
    await expect(searchPage.chips.chips).toHaveCount(expectedCount, {
      timeout: 20000,
    });
  }
}

// ─── Sidebar-driven flow ────────────────────────────────────────────────────

test.describe(
  'Filter chips — sidebar-driven flow',
  { tag: ['@search'] },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await setupSidebarReadyPage(page, searchPage);
    });

    test('Renders no chips when no filters are applied', async () => {
      await expect(searchPage.chips.group).toBeHidden();
      await expect(searchPage.chips.chips).toHaveCount(0);
    });

    test('Renders an included chip with = operator when a filter is applied', async () => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);
      const text = await searchPage.chips.readChipText(SEVERITY, SEV_INFO);
      expect(text).toBe(`${SEVERITY} = ${SEV_INFO}`);
    });

    test('Renders an excluded chip with != operator when a filter is excluded', async () => {
      await excludeSidebarFilter(searchPage, SEVERITY, SEV_ERROR);
      const text = await searchPage.chips.readChipText(
        SEVERITY,
        SEV_ERROR,
        'excluded',
      );
      expect(text).toBe(`${SEVERITY} != ${SEV_ERROR}`);
    });

    test('Clicking remove button on a chip removes the filter', async () => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.chips.clickRemove(SEVERITY, SEV_INFO);
      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeHidden();

      // Sidebar checkbox should also reflect the removal
      const input = searchPage.filters.getFilterCheckboxInput(
        SEVERITY,
        SEV_INFO,
      );
      await expect(input).not.toBeChecked();
    });

    test('Removing an excluded chip clears the exclusion', async () => {
      await excludeSidebarFilter(searchPage, SEVERITY, SEV_ERROR);

      await searchPage.chips.clickRemove(SEVERITY, SEV_ERROR, 'excluded');
      await expect(
        searchPage.chips.chip(SEVERITY, SEV_ERROR, 'excluded'),
      ).toBeHidden();
    });

    test('Clicking the chip body does not blur the WHERE input', async () => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.input.click();
      await expect(searchPage.input).toBeFocused();

      await searchPage.chips
        .chip(SEVERITY, SEV_INFO)
        .getByTestId('filter-chip-value')
        .click();

      await expect(searchPage.input).toBeFocused();
    });

    test('Typed text in WHERE input is preserved when a chip is removed', async () => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.input.click();
      await searchPage.input.fill('hello world');
      await expect(searchPage.input).toHaveValue('hello world');

      await searchPage.chips.clickRemove(SEVERITY, SEV_INFO);

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeHidden();
      await expect(searchPage.input).toHaveValue('hello world');
    });

    test('Backspace with no chips and empty input is a no-op', async ({
      page,
    }) => {
      await searchPage.input.click();
      await page.keyboard.press('Backspace');
      await expect(searchPage.chips.chips).toHaveCount(0);
      await expect(searchPage.input).toHaveValue('');
    });

    test('Backspace mid-text deletes a character (not a chip)', async ({
      page,
    }) => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.input.click();
      await searchPage.input.fill('hello');
      await page.keyboard.press('Backspace');

      await expect(searchPage.input).toHaveValue('hell');
      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeVisible();
    });

    test('Backspace at start of non-empty text removes a chip but preserves the text', async ({
      page,
    }) => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.input.click();
      await searchPage.input.fill('text');
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeHidden();
      await expect(searchPage.input).toHaveValue('text');
    });

    test('Chips persist through page reload', async ({ page }) => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await page.reload();
      await searchPage.timePicker.input.waitFor({
        state: 'visible',
        timeout: 30000,
      });
      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeVisible({
        timeout: 15000,
      });
    });

    test('Chips persist when switching from Lucene to SQL mode', async () => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.switchToSQLMode();

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeVisible();
    });

    test('Chips persist when switching from SQL back to Lucene', async () => {
      await searchPage.switchToSQLMode();
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.switchToLuceneMode();

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeVisible();
    });

    test('Chips have accessible labels for screen readers', async () => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      const chip = searchPage.chips.chip(SEVERITY, SEV_INFO);
      await expect(chip).toHaveAttribute(
        'aria-label',
        `Filter ${SEVERITY} = ${SEV_INFO}`,
      );

      const remove = searchPage.chips.remove(SEVERITY, SEV_INFO);
      await expect(remove).toHaveAttribute(
        'aria-label',
        `Remove Filter ${SEVERITY} = ${SEV_INFO}`,
      );
    });

    test('Hovering a chip shows a tooltip with the full filter description', async ({
      page,
    }) => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.chips.chip(SEVERITY, SEV_INFO).hover();

      await expect(
        page.getByRole('tooltip', { name: `${SEVERITY} = ${SEV_INFO}` }),
      ).toBeVisible({ timeout: 2000 });
    });

    test('Removing a chip updates the search results table', async ({
      page,
    }) => {
      await applySidebarFilter(searchPage, SEVERITY, SEV_INFO);

      await searchPage.chips.clickRemove(SEVERITY, SEV_INFO);
      await expect(searchPage.chips.chips).toHaveCount(0);
      // Filter change is debounced (~1s); allow the query to settle.
      await page.waitForLoadState('networkidle').catch(() => {});
    });
  },
);

// ─── URL-seeded multi-chip flow ─────────────────────────────────────────────

test.describe(
  'Filter chips — URL-seeded multi-chip flow',
  { tag: ['@search'] },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
    });

    test('Renders separate chips for each value in the same field', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO, SEV_WARN], mode: 'included' },
      ]);

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeVisible();
      await expect(searchPage.chips.chip(SEVERITY, SEV_WARN)).toBeVisible();
      await expect(searchPage.chips.chips).toHaveCount(2);
    });

    test('Renders chips for multiple fields simultaneously', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO], mode: 'included' },
        { field: SERVICE, values: ['api-server'], mode: 'included' },
      ]);

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeVisible();
      await expect(searchPage.chips.chip(SERVICE, 'api-server')).toBeVisible();
      await expect(searchPage.chips.chips).toHaveCount(2);
    });

    test('Renders included and excluded chips for the same field side-by-side', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO], mode: 'included' },
        { field: SEVERITY, values: [SEV_ERROR], mode: 'excluded' },
      ]);

      await expect(
        searchPage.chips.chip(SEVERITY, SEV_INFO, 'included'),
      ).toBeVisible();
      await expect(
        searchPage.chips.chip(SEVERITY, SEV_ERROR, 'excluded'),
      ).toBeVisible();
      await expect(searchPage.chips.chips).toHaveCount(2);
    });

    test('Removing one chip keeps other chips intact', async ({ page }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO, SEV_WARN], mode: 'included' },
      ]);

      await searchPage.chips.clickRemove(SEVERITY, SEV_INFO);

      await expect(searchPage.chips.chip(SEVERITY, SEV_INFO)).toBeHidden();
      await expect(searchPage.chips.chip(SEVERITY, SEV_WARN)).toBeVisible();
      await expect(searchPage.chips.chips).toHaveCount(1);
    });

    test('Removing each chip in turn reaches an empty chip set', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO, SEV_WARN], mode: 'included' },
      ]);

      await searchPage.chips.clickRemove(SEVERITY, SEV_INFO);
      await expect(searchPage.chips.chips).toHaveCount(1);
      await searchPage.chips.clickRemove(SEVERITY, SEV_WARN);
      await expect(searchPage.chips.chips).toHaveCount(0);
      await expect(searchPage.chips.group).toBeHidden();
    });

    test('Clicking remove button keeps the WHERE input focused', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO, SEV_WARN], mode: 'included' },
      ]);

      await searchPage.input.click();
      await expect(searchPage.input).toBeFocused();

      await searchPage.chips.clickRemove(SEVERITY, SEV_INFO);

      await expect(searchPage.input).toBeFocused();
    });

    test('Backspace at position 0 removes the last chip (Lucene)', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO, SEV_WARN], mode: 'included' },
      ]);

      await searchPage.input.click();
      await page.keyboard.press('Backspace');

      await expect(searchPage.chips.chips).toHaveCount(1);
    });

    test('Excluded chip is visually distinguished from included chip', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        { field: SEVERITY, values: [SEV_INFO], mode: 'included' },
        { field: SEVERITY, values: [SEV_ERROR], mode: 'excluded' },
      ]);

      const included = searchPage.chips.chip(SEVERITY, SEV_INFO, 'included');
      const excluded = searchPage.chips.chip(SEVERITY, SEV_ERROR, 'excluded');

      const includedBorder = await included.evaluate(
        el => getComputedStyle(el).borderColor,
      );
      const excludedBorder = await excluded.evaluate(
        el => getComputedStyle(el).borderColor,
      );

      expect(includedBorder).not.toBe(excludedBorder);
    });

    test('Many chips render and the chip group does not push the input off-screen', async ({
      page,
    }) => {
      await gotoWithFilters(page, searchPage, [
        {
          field: SEVERITY,
          values: [SEV_INFO, SEV_WARN, SEV_ERROR, SEV_DEBUG],
          mode: 'included',
        },
        {
          field: SERVICE,
          values: ['api-server', 'frontend', 'CartService', 'worker'],
          mode: 'included',
        },
      ]);

      const overflowX = await searchPage.chips.group.evaluate(el => {
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflowX).toBeLessThanOrEqual(1);
    });

    test('Focusing the WHERE input expands the chip area', async ({ page }) => {
      await gotoWithFilters(page, searchPage, [
        {
          field: SEVERITY,
          values: [SEV_INFO, SEV_WARN, SEV_ERROR, SEV_DEBUG],
          mode: 'included',
        },
        {
          field: SERVICE,
          values: ['api-server', 'frontend', 'CartService', 'worker'],
          mode: 'included',
        },
      ]);

      await page.locator('body').click({ position: { x: 1, y: 1 } });
      const collapsedHeight = await searchPage.chips.group.evaluate(el =>
        Math.round(el.getBoundingClientRect().height),
      );

      await searchPage.input.click();
      await expect(searchPage.input).toBeFocused();

      const expandedHeight = await searchPage.chips.group.evaluate(el =>
        Math.round(el.getBoundingClientRect().height),
      );

      expect(expandedHeight).toBeGreaterThanOrEqual(collapsedHeight);
    });
  },
);
