/**
 * Multiple PromQL expressions on one tile: each expression is queried
 * separately, carries its own alias (naming its series) and is listed in the
 * Generated PromQL preview.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service`, so each expression below matches exactly one known series.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

const ACCOUNTING = `${E2E_PROMQL_METRIC_NAME}{service="accounting"}`;
const API_SERVER = `${E2E_PROMQL_METRIC_NAME}{service="api-server"}`;

test.describe(
  'PromQL multiple expressions',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('plots, names, previews and round-trips two expressions', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const legend = page.locator('.recharts-legend-wrapper').first();

      await test.step('Create a dashboard with a two-expression PromQL tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL multi-expression tile');
        await editor.replacePromqlExpression(ACCOUNTING);
        await editor.addPromqlExpression();
        await editor.replacePromqlExpression(API_SERVER, 1);
        await editor.setSeriesAlias(0, 'up-acct');
        await editor.setSeriesAlias(1, 'up-api');
      });

      await test.step('Both expressions are listed in the preview', async () => {
        await editor.runQuery();
        await editor.openGeneratedPromql();
        const previews = page.getByTestId('chart-promql-preview');
        await expect(previews).toHaveCount(2);
        await expect(previews.nth(0)).toContainText(ACCOUNTING);
        await expect(previews.nth(1)).toContainText(API_SERVER);
      });

      await test.step('Each expression names its series after its alias', async () => {
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        // Each expression returns a single series, so its alias identifies it
        // on its own and nothing is appended.
        for (const alias of ['up-acct', 'up-api']) {
          await expect(legend.getByText(alias, { exact: true })).toBeVisible({
            timeout: 30000,
          });
        }
      });

      await test.step("The chart's legend template names every expression", async () => {
        await dashboardPage.editTile(0);
        await expect(editor.nameInput).toBeVisible();
        await editor.setLegendTemplate('chart:{{service}}');
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(
          legend.getByText('up-acct · chart:accounting'),
        ).toBeVisible({ timeout: 30000 });
        await expect(
          legend.getByText('up-api · chart:api-server'),
        ).toBeVisible();
      });

      await test.step('Both expressions round-trip into the editor', async () => {
        await dashboardPage.editTile(0);
        await expect(editor.nameInput).toBeVisible();
        expect(await editor.getPromqlEditorText(0)).toContain(ACCOUNTING);
        expect(await editor.getPromqlEditorText(1)).toContain(API_SERVER);
        await expect(editor.seriesAliasInput(0)).toHaveValue('up-acct');
        await expect(editor.seriesAliasInput(1)).toHaveValue('up-api');
      });

      await test.step('Copying an expression duplicates it without its alias', async () => {
        await editor.duplicateSeries(1);
        expect(await editor.getPromqlEditorText(2)).toContain(API_SERVER);
        // The copy starts unaliased: a shared alias would only distinguish the
        // two series by a trailing counter.
        await expect(editor.seriesAliasInput(2)).toHaveValue('');
        await editor.duplicateSeries(2);
        await expect(editor.seriesAliasInput(3)).toHaveValue('');
        await page
          .getByRole('button', { name: 'Remove', exact: true })
          .nth(3)
          .click();
        await page
          .getByRole('button', { name: 'Remove', exact: true })
          .nth(2)
          .click();
        await expect(page.getByTestId('series-alias-input')).toHaveCount(2);
      });

      await test.step('Removing an expression leaves the other plotted', async () => {
        await page
          .getByRole('button', { name: 'Remove', exact: true })
          .first()
          .click();
        // The last expression cannot be removed: nothing would be left to edit.
        await expect(
          page.getByRole('button', { name: 'Remove', exact: true }),
        ).toHaveCount(0);
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(legend.getByText('up-api · chart:api-server')).toBeVisible(
          { timeout: 30000 },
        );
        await expect(legend.getByText(/up-acct/)).toHaveCount(0);
      });
    });
  },
);
