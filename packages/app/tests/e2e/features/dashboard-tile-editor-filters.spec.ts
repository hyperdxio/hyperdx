/**
 * The tile editor previews a tile as the dashboard renders it: the dashboard's
 * filter selections and variables are applied by default, and the "Apply
 * filters" switch turns them off. An alert forces the switch off — alerts
 * evaluate without the dashboard's selections — and an unsatisfied required
 * filter blocks the preview the same way it blocks the tile.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

const SERVICE = 'frontend';

test.describe(
  'Dashboard filters in the tile editor preview',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    /** The generated SQL, retried: the preview re-queries when the toggle flips. */
    const expectGeneratedSql = async (
      assertion: (sql: string) => void,
    ): Promise<void> => {
      await expect(async () => {
        assertion(await dashboardPage.chartEditor.getGeneratedSqlText());
      }).toPass({ timeout: 20000 });
    };

    test('applies the selected filters, and stops when toggled off', async () => {
      test.setTimeout(180000);

      await test.step('Create a tile and a broadcasting Service filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTileWithSource(
          'Logs count',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
        );
        await dashboardPage.closeFiltersModal();
        await dashboardPage.toggleFilterValue('Service', SERVICE);
      });

      await test.step('The preview queries with the selection', async () => {
        await dashboardPage.editTile(0);
        await expect(
          dashboardPage.chartEditor.applyDashboardFiltersSwitch(),
        ).toBeChecked();

        await dashboardPage.chartEditor.openGeneratedSql();
        await expectGeneratedSql(sql => expect(sql).toContain(SERVICE));
      });

      await test.step('Toggling the filters off drops it', async () => {
        await dashboardPage.chartEditor.setApplyDashboardFilters(false);

        await expectGeneratedSql(sql => expect(sql).not.toContain(SERVICE));
      });

      await test.step('Toggling them back on restores it', async () => {
        await dashboardPage.chartEditor.setApplyDashboardFilters(true);

        await expectGeneratedSql(sql => expect(sql).toContain(SERVICE));
      });

      await test.step('Configuring an alert forces the switch off', async () => {
        await dashboardPage.chartEditor.clickAddAlert();

        const toggle = dashboardPage.chartEditor.applyDashboardFiltersSwitch();
        await expect(toggle).not.toBeChecked();
        await expect(toggle).toBeDisabled();
        await expectGeneratedSql(sql => expect(sql).not.toContain(SERVICE));

        await dashboardPage.chartEditor.hoverApplyDashboardFilters();
        await expect(
          dashboardPage.page.getByText(
            /cannot be applied when an alert is configured/i,
          ),
        ).toBeVisible();
      });
    });

    test('blocks the preview on an unsatisfied required filter', async () => {
      test.setTimeout(180000);

      await test.step('Create a tile and a required Service filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTileWithSource(
          'Logs count',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { required: true },
        );
        await dashboardPage.closeFiltersModal();
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('The preview names the filter it is waiting on', async () => {
        await dashboardPage.editTile(0);

        const placeholder =
          dashboardPage.chartEditor.previewMissingRequiredFilters();
        await expect(placeholder).toBeVisible({ timeout: 20000 });
        await expect(placeholder).toContainText(
          'Missing required filters: Service',
        );
      });

      await test.step('Turning the filters off unblocks it', async () => {
        await dashboardPage.chartEditor.setApplyDashboardFilters(false);

        await expect(
          dashboardPage.chartEditor.previewMissingRequiredFilters(),
        ).toHaveCount(0);
        await expect(
          dashboardPage.chartEditor.tileEditorPreviewChart(),
        ).toBeVisible({ timeout: 30000 });
      });
    });
  },
);
