import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search row multi-select', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test(
    'reveals a row checkbox only while the row is hovered',
    { tag: ['@local-mode'] },
    async () => {
      const checkbox = searchPage.table.getRowCheckboxCell(0);
      await expect(checkbox).toHaveCSS('opacity', '0');

      await searchPage.table.hoverRow(0);
      await expect(checkbox).toHaveCSS('opacity', '1');

      await searchPage.table.hoverRow(3);
      await expect(checkbox).toHaveCSS('opacity', '0');
    },
  );

  test(
    'shows every checkbox while a selection exists',
    { tag: ['@local-mode'] },
    async () => {
      // Row 3 is never hovered here, so it can only be visible because the
      // table is in selection mode — which is what keeps shift-click aimable.
      const unhovered = searchPage.table.getRowCheckboxCell(3);
      await expect(unhovered).toHaveCSS('opacity', '0');

      await searchPage.table.selectRows([0]);
      await expect(unhovered).toHaveCSS('opacity', '1');

      await searchPage.clearRowSelection();
      await expect(unhovered).toHaveCSS('opacity', '0');
    },
  );

  test(
    'selects rows and reports the count',
    { tag: ['@local-mode'] },
    async () => {
      await expect(searchPage.selectionCount).toBeHidden();

      await searchPage.table.selectRows([0, 1]);

      await expect(searchPage.selectionCount).toHaveText('2 selected');
    },
  );

  test(
    'shift-clicking extends the selection',
    { tag: ['@local-mode'] },
    async () => {
      await searchPage.table.selectRows([0]);
      await searchPage.table.shiftSelectRow(3);

      await expect(searchPage.selectionCount).toHaveText('4 selected');
      expect(await searchPage.table.getSelectedRowCount()).toBe(4);
    },
  );

  test(
    'clearing the selection hides the bar',
    { tag: ['@local-mode'] },
    async () => {
      await searchPage.table.selectRows([0]);
      await expect(searchPage.selectionCount).toBeVisible();

      await searchPage.clearRowSelection();

      await expect(searchPage.selectionCount).toBeHidden();
      expect(await searchPage.table.getSelectedRowCount()).toBe(0);
    },
  );

  test(
    'downloads the selected rows as CSV',
    { tag: ['@local-mode'] },
    async () => {
      await searchPage.table.selectRows([0, 1]);

      const { filename, content } = await searchPage.downloadSelectedRowsCsv();

      expect(filename).toMatch(/^hyperdx_selected_rows_.*\.csv$/);
      expect(filename).not.toMatch(/\.csv\.csv$/);

      const lines = content
        .replace(/^\ufeff/, '')
        .trim()
        .split(/\r?\n/);
      // One header row plus one row per selection.
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('Timestamp');
    },
  );

  test(
    'copies the selected rows as CSV',
    { tag: ['@local-mode'] },
    async ({ context, page }) => {
      // copyTextToClipboard falls back to execCommand when the async clipboard
      // API is unavailable, and that fallback's result is not observable, so
      // the toast is the primary assertion here.
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await searchPage.table.selectRows([0, 1]);
      await searchPage.copySelectedRows();

      await expect(searchPage.getCopiedSelectionToast()).toBeVisible();

      const clipboard = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(clipboard.split(/\r?\n/)).toHaveLength(3);
      expect(clipboard).not.toContain('__hyperdx_');
    },
  );

  test(
    'copies the selected rows as JSON',
    { tag: ['@local-mode'] },
    async ({ context, page }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await searchPage.table.selectRows([0, 1]);
      await searchPage.copySelectedRows('json');

      await expect(searchPage.getCopiedSelectionToast()).toBeVisible();

      const clipboard = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      const rows = JSON.parse(clipboard);
      expect(rows).toHaveLength(2);

      // The same columns the CSV writes — the query appends primary key,
      // partition key and block columns that must not reach an export.
      const { content } = await searchPage.downloadSelectedRowsCsv();
      const header = content
        .replace(/^\ufeff/, '')
        .split(/\r?\n/)[0]
        .split(',')
        .map(name => name.replace(/^"|"$/g, ''));
      expect(Object.keys(rows[0])).toEqual(header);
    },
  );

  test(
    'leaves live tail, visibly, when rows are selected',
    { tag: ['@local-mode'] },
    async () => {
      await expect(searchPage.resumeLiveTailButton).toBeHidden();

      await searchPage.table.selectRows([0]);

      // Same exit as expanding a row: the Resume button is the affordance that
      // says tailing stopped.
      await expect(searchPage.resumeLiveTailButton).toBeVisible();
      await expect(searchPage.selectionCount).toHaveText('1 selected');

      // And it is undoable. The selection outlives the click itself, since
      // resuming only moves the searched window on the next refresh.
      await searchPage.resumeLiveTail();

      await expect(searchPage.resumeLiveTailButton).toBeHidden();
    },
  );

  test(
    'drops the selection when the time range changes',
    { tag: ['@local-mode'] },
    async () => {
      await searchPage.table.selectRows([0, 1]);
      await expect(searchPage.selectionCount).toHaveText('2 selected');

      // A different window is a different result set.
      await searchPage.timePicker.selectRelativeTime('Last 1 days');

      await expect(searchPage.selectionCount).toBeHidden();
    },
  );

  test(
    'does not restore the selection when the query reverts',
    { tag: ['@local-mode'] },
    async () => {
      // Pin an absolute window first. In live tail every submit re-parses
      // "Live Tail" into a fresh range, so the reset key would differ on the
      // way back for reasons other than the query.
      await searchPage.timePicker.selectRelativeTime('Last 1 days');
      await searchPage.performSearch('SeverityText:info');

      await searchPage.table.selectRows([0, 1]);
      await expect(searchPage.selectionCount).toHaveText('2 selected');

      await searchPage.performSearch('SeverityText:warn');
      await expect(searchPage.selectionCount).toBeHidden();

      // Back to the query the rows were selected under: the same result set is
      // on screen, but the selection stays gone.
      await searchPage.performSearch('SeverityText:info');

      await expect(searchPage.table.firstRow).toBeVisible();
      await expect(searchPage.selectionCount).toBeHidden();
      expect(await searchPage.table.getSelectedRowCount()).toBe(0);
    },
  );

  test(
    'checking a row does not open the side panel',
    { tag: ['@local-mode'] },
    async () => {
      await searchPage.table.selectRows([0]);
      await expect(searchPage.sidePanel.container).toBeHidden();

      await searchPage.table.clickRow(0);

      await expect(searchPage.sidePanel.container).toBeVisible();
    },
  );
});
