import { DashboardImportPage } from '../page-objects/DashboardImportPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_METRICS_SOURCE_NAME } from '../utils/constants';

test.describe('Dashboard Template Import', { tag: ['@dashboard'] }, () => {
  let dashboardsListPage: DashboardsListPage;
  let dashboardImportPage: DashboardImportPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(({ page }) => {
    dashboardsListPage = new DashboardsListPage(page);
    dashboardImportPage = new DashboardImportPage(page);
    dashboardPage = new DashboardPage(page);
  });

  test(
    'should import a template from listing page through to new dashboard',
    { tag: '@full-stack' },
    async ({ page }) => {
      await test.step('Navigate to dashboard listing page and verify templates link', async () => {
        await dashboardsListPage.goto();
        await expect(dashboardsListPage.pageContainer).toBeVisible();
        await expect(dashboardsListPage.browseTemplatesLink).toBeVisible();
      });

      await test.step('Navigate to templates page via Browse dashboard templates link', async () => {
        await dashboardsListPage.clickBrowseTemplates();
        await expect(page).toHaveURL(/\/dashboards\/templates/);
        await expect(dashboardImportPage.templatesPageContainer).toBeVisible();
      });

      await test.step('Verify template cards are listed', async () => {
        await expect(
          dashboardImportPage.getTemplateImportButton('dotnet-runtime'),
        ).toBeVisible();
        await expect(
          dashboardImportPage.getTemplateImportButton('jvm-runtime-metrics'),
        ).toBeVisible();
      });

      await test.step('Click Import on the .NET Runtime Metrics template', async () => {
        await dashboardImportPage.clickImportTemplate('dotnet-runtime');
        await expect(page).toHaveURL(
          /\/dashboards\/import\?template=dotnet-runtime/,
        );
      });

      await test.step('Verify the import mapping page loaded correctly', async () => {
        // File upload dropzone is not rendered in template mode
        await expect(dashboardImportPage.fileUploadDropzone).toBeHidden();
        // Step 2 mapping form is visible
        await expect(dashboardImportPage.mappingStepHeading).toBeVisible();
        // Dashboard name is pre-filled from the template
        await expect(dashboardImportPage.dashboardNameInput).toHaveValue(
          '.NET Runtime Metrics',
        );
        // A tile name from the .NET template is shown in the mapping table
        await expect(page.getByText('GC Heap Size')).toBeVisible();
      });

      await test.step('Map the first source dropdown to E2E Metrics', async () => {
        await dashboardImportPage.selectSourceMapping(
          DEFAULT_METRICS_SOURCE_NAME,
          0,
        );
      });

      await test.step('Submit the import and verify success notification', async () => {
        await dashboardImportPage.finishImportButton.click();
        await expect(
          dashboardImportPage.getImportSuccessNotification(),
        ).toBeVisible();
        await page.waitForURL(/\/dashboards\/.+/);
      });

      await test.step('Verify the new dashboard has the correct name', async () => {
        await expect(page).toHaveURL(/\/dashboards\/.+/);
        await expect(
          dashboardPage.getDashboardHeading('.NET Runtime Metrics'),
        ).toBeVisible();
      });
    },
  );

  test(
    'should show error for invalid template name',
    { tag: '@full-stack' },
    async () => {
      await test.step('Navigate to import page with a nonexistent template param', async () => {
        await dashboardImportPage.gotoImport('nonexistent-template');
      });

      await test.step('Verify template-not-found error and link to templates', async () => {
        await expect(dashboardImportPage.templateNotFoundText).toBeVisible();
        await expect(
          dashboardImportPage.browseAvailableTemplatesLink,
        ).toBeVisible();
        await expect(
          dashboardImportPage.browseAvailableTemplatesLink,
        ).toHaveAttribute('href', '/dashboards/templates');
      });
    },
  );
});
