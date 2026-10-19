import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../../utils/constants';

test.describe('Search histogram group by', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
  });

  test('defaults to the source group by without a URL param', async ({
    page,
  }) => {
    await expect(searchPage.groupByButton).toHaveText('SeverityText');
    await expect(page).not.toHaveURL(/[?&]groupBy=/);
  });

  test('applies a custom group by, keeps it in the URL, and syncs the SQL tab', async ({
    page,
  }) => {
    await searchPage.setGroupByFields(['ServiceName']);

    await expect(page).toHaveURL(/[?&]groupBy=ServiceName/);
    await expect(searchPage.groupByButton).toHaveText('ServiceName');
    await expect(searchPage.getHistogram()).toBeVisible();

    await page.reload();
    await expect(searchPage.groupByButton).toHaveText('ServiceName');

    await searchPage.openGroupBy();
    await searchPage.openGroupBySqlTab();
    await expect(searchPage.groupByDropdown.locator('.cm-content')).toHaveText(
      'ServiceName',
    );
  });

  test('applies a SQL group by and shows its fields as checked', async ({
    page,
  }) => {
    await searchPage.setGroupBySql('ServiceName, SeverityText');

    await expect(page).toHaveURL(/[?&]groupBy=ServiceName/);
    await expect(searchPage.groupByButton).toHaveText('2 fields');

    await searchPage.openGroupBy();
    for (const field of ['ServiceName', 'SeverityText']) {
      await expect(
        searchPage.groupByDropdown.getByRole('checkbox', {
          name: field,
          exact: true,
        }),
      ).toBeChecked();
    }
  });

  test('clears to no grouping and resets to the default', async ({ page }) => {
    await searchPage.setGroupByFields([]);
    await expect(page).toHaveURL(/[?&]groupBy=(&|$)/);
    await expect(searchPage.groupByButton).toHaveText('none');

    await searchPage.openGroupBy();
    await searchPage.groupByDropdown
      .getByRole('button', { name: 'Reset to default' })
      .click();
    await expect(searchPage.groupByButton).toHaveText('SeverityText');
    await expect(page).not.toHaveURL(/[?&]groupBy=/);
  });

  test('shows a legend only for a custom group by', async () => {
    await searchPage.setGroupByFields(['ServiceName']);
    await expect(searchPage.getHistogramLegend()).toBeVisible();

    await searchPage.openGroupBy();
    await searchPage.groupByDropdown
      .getByRole('button', { name: 'Reset to default' })
      .click();
    await expect(searchPage.groupByButton).toHaveText('SeverityText');
    await expect(searchPage.getHistogramLegend()).toBeHidden();
  });

  test('focusing a series filters on each group-by field, including expressions', async ({
    page,
  }) => {
    await searchPage.setGroupBySql('ServiceName, lower(SeverityText)');
    await searchPage.focusFirstHistogramSeries();

    await expect(async () => {
      const raw = new URL(page.url()).searchParams.get('filters') ?? '[]';
      const conditions = JSON.parse(decodeURIComponent(raw)).map(
        (f: { condition: string }) => f.condition,
      );
      expect(conditions).toEqual([
        expect.stringMatching(/^ServiceName IN \('.+'\)$/),
        expect.stringMatching(/^lower\(SeverityText\) IN \('.+'\)$/),
      ]);
    }).toPass({ timeout: 10000 });
    await expect(searchPage.groupByButton).toHaveText('2 fields');
  });

  test('shows in event patterns mode but not event deltas mode', async ({
    page,
  }) => {
    await searchPage.setGroupByFields(['ServiceName']);
    await searchPage.eventPatternsTab.click();
    await expect(page).toHaveURL(/[?&]mode=pattern/);
    await expect(searchPage.groupByButton).toHaveText('ServiceName');

    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.switchToEventDeltas();
    await expect(searchPage.groupByButton).toBeHidden();
  });

  test('keeps a compatible group by when switching sources', async ({
    page,
  }) => {
    await searchPage.setGroupByFields(['ServiceName']);
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await expect(page).toHaveURL(/[?&]groupBy=ServiceName/);
    await expect(searchPage.groupByButton).toHaveText('ServiceName');
  });

  test('drops an incompatible group by when switching sources', async ({
    page,
  }) => {
    await searchPage.setGroupByFields(['SeverityText']);
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await expect(page).not.toHaveURL(/[?&]groupBy=/);
    await expect(searchPage.groupByButton).toHaveText('StatusCode');
    await expect(
      searchPage.getDroppedGroupByToast('SeverityText'),
    ).toBeVisible();
  });

  test('keeps the compatible fields of a group by when switching sources', async ({
    page,
  }) => {
    await searchPage.setGroupBySql('ServiceName, SeverityText');
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await expect(
      searchPage.getDroppedGroupByToast('SeverityText'),
    ).toBeVisible();
    await expect(page).toHaveURL(/[?&]groupBy=ServiceName(&|$)/);
    await expect(searchPage.groupByButton).toHaveText('ServiceName');
  });
});
