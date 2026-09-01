/**
 * STATIC_LIST dashboard filters render as dropdowns offering their authored
 * options, and the selection reaches tiles as `$variableName`.
 *
 * The filter editor can't author static filters yet, so the dashboard is
 * seeded through the external API — which also makes this `@full-stack`, along
 * with the tile's real count query.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { getApiUrl, getSources, getUserAccessKey } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';

test.describe(
  'Static list dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    const BASE_URL = `${getApiUrl()}/api/v2/dashboards`;

    // Deliberately not alphabetical: the dropdown must keep this order.
    const OPTIONS = ['warn', 'error', 'debug', 'info'];

    test('offers options in definition order and feeds the selection to tiles', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();

      const accessKey = await getUserAccessKey(page);
      const [logSource] = await getSources(page, 'log');

      await test.step('Seed a dashboard with a static filter via the external API', async () => {
        const createResponse = await page.request.post(BASE_URL, {
          headers: {
            Authorization: `Bearer ${accessKey}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: `Static filter test ${Date.now()}`,
            tiles: [
              {
                name: 'Log count',
                x: 0,
                y: 0,
                w: 6,
                h: 3,
                config: {
                  displayType: 'number',
                  sourceId: logSource._id,
                  select: [
                    {
                      aggFn: 'count',
                      where: '$__filter(SeverityText, $sev)',
                      whereLanguage: 'sql',
                    },
                  ],
                },
              },
            ],
            filters: [
              {
                type: 'STATIC_LIST',
                name: 'Severity',
                options: OPTIONS,
                variableName: 'sev',
              },
            ],
          },
        });
        expect(createResponse.ok()).toBeTruthy();
        const dashboardId = (await createResponse.json()).data.id;
        await dashboardPage.gotoDashboard(dashboardId);
      });

      let unfilteredCount: string;
      await test.step('The tile renders the unfiltered count ($__filter is a no-op unselected)', async () => {
        await expect(dashboardPage.getNumberTileValue()).toHaveText(/\d/, {
          timeout: 30000,
        });
        unfilteredCount = await dashboardPage.getNumberTileValue().innerText();
      });

      await test.step('The dropdown offers the options in definition order', async () => {
        await dashboardPage.openFilterDropdown('Severity');
        await expect(page.getByRole('option')).toHaveText(OPTIONS);
        await page.keyboard.press('Escape');
      });

      await test.step('Selecting a value narrows the tile through $sev', async () => {
        await dashboardPage.toggleFilterValue('Severity', 'error');
        // Seed logs spread severities evenly, so the error-only count is
        // strictly below the total.
        await expect(dashboardPage.getNumberTileValue()).not.toHaveText(
          unfilteredCount,
          { timeout: 30000 },
        );
        await expect(
          dashboardPage.getFilterPill('Severity', 'error'),
        ).toBeVisible();
      });

      await test.step('The selection survives a reload via the URL state', async () => {
        await page.reload();
        await expect(
          dashboardPage.getFilterPill('Severity', 'error'),
        ).toBeVisible({ timeout: 30000 });
      });
    });
  },
);
