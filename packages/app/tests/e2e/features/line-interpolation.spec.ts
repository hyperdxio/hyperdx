import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';

test.describe('Line interpolation', { tag: ['@dashboard'] }, () => {
  test('renders stepped lines and round-trips into the editor', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const curve = dashboardPage
      .getTiles()
      .first()
      .locator('.recharts-area-curve')
      .first();

    await test.step('Create a line tile with step interpolation', async () => {
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.addTile();
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await editor.setChartName('Step line tile');
      await editor.setLineInterpolation('Step');
      await editor.save();
      await expect(dashboardPage.getTiles()).toHaveCount(1, {
        timeout: 10000,
      });
    });

    await test.step('The line is drawn with step segments', async () => {
      // A step is two consecutive points sharing an x; the smooth default
      // draws cubic (C) segments instead.
      await expect(curve).toHaveAttribute('d', /L([\d.]+),[\d.]+L\1,/, {
        timeout: 30000,
      });
      await expect(curve).not.toHaveAttribute('d', /C/);
    });

    await test.step('The setting round-trips into the editor', async () => {
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.openDisplaySettings();
      await expect(editor.lineInterpolationOption('Step')).toBeChecked();
    });
  });
});
