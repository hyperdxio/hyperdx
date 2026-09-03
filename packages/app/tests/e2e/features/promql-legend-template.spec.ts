/**
 * PromQL legend templates: a Handlebars template on the tile config renders
 * each series' Prometheus labels into the legend name in place of the default
 * `metric{label="value"}` form.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service`, so `{{service}}` resolves to a known set of short names.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

test.describe(
  'PromQL legend template',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('renders, round-trips, validates, and clears', async ({ page }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const legend = page.locator('.recharts-legend-wrapper').first();
      const drawer = page.getByRole('dialog', { name: 'Display Settings' });

      await test.step('Create a dashboard with a PromQL tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectPromqlSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL legend tile');
        // Two known series: the full metric has one per seeded service, and
        // the legend only shows a subset when there are many.
        await editor.replacePromqlExpression(
          `${E2E_PROMQL_METRIC_NAME}{service=~"accounting|api-server"}`,
        );
      });

      await test.step('Set a legend template and save', async () => {
        await editor.setLegendTemplate('svc:{{service}}');
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('The legend shows templated series names', async () => {
        for (const service of ['accounting', 'api-server']) {
          await expect(legend.getByText(`svc:${service}`)).toBeVisible({
            timeout: 30000,
          });
        }
        // The default `e2e_service_up{service="…"}` form is gone.
        await expect(legend.getByText(/service="/)).toHaveCount(0);
      });

      await test.step('The template round-trips in the editor', async () => {
        await dashboardPage.editTile(0);
        await expect(editor.nameInput).toBeVisible();
        await editor.openDisplaySettings();
        await expect(drawer.getByTestId('legend-template-input')).toHaveValue(
          'svc:{{service}}',
        );
      });

      await test.step('An invalid template keeps the drawer open with an error', async () => {
        await drawer.getByTestId('legend-template-input').fill('{{unclosed');
        await drawer
          .getByRole('button', { name: 'Apply', exact: true })
          .click();
        await expect(
          drawer.getByText('Invalid Handlebars template'),
        ).toBeVisible();
        await expect(drawer).toBeVisible();
      });

      await test.step('Clearing the template restores the default legend', async () => {
        await drawer.getByTestId('legend-template-input').fill('');
        await drawer
          .getByRole('button', { name: 'Apply', exact: true })
          .click();
        await drawer.waitFor({ state: 'hidden', timeout: 5000 });
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        // Matched on the tail: the legend truncates the middle past 35
        // characters, and `e2e_service_up{service="…"}` exceeds that.
        await expect(legend.getByText('accounting"}')).toBeVisible({
          timeout: 30000,
        });
      });
    });
  },
);
