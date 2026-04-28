/**
 * DashboardImportPage - Page object for dashboard template browsing and import
 * Covers the /dashboards/templates page and the /dashboards/import page
 */
import { Locator, Page } from '@playwright/test';

export class DashboardImportPage {
  readonly page: Page;
  readonly templatesPageContainer: Locator;
  readonly mappingStepHeading: Locator;
  readonly dashboardNameInput: Locator;
  readonly finishImportButton: Locator;
  readonly fileUploadDropzone: Locator;
  readonly fileUploadInput: Locator;
  readonly templateNotFoundText: Locator;
  readonly browseAvailableTemplatesLink: Locator;
  readonly importErrorTitle: Locator;
  readonly showErrorDetailsButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.templatesPageContainer = page.getByTestId('dashboard-templates-page');
    this.mappingStepHeading = page.getByText('Step 2: Map Data');
    this.dashboardNameInput = page.getByLabel('Dashboard Name');
    this.finishImportButton = page.getByRole('button', {
      name: 'Finish Import',
    });
    this.fileUploadDropzone = page.getByText('Drag and drop a JSON file here', {
      exact: false,
    });
    this.fileUploadInput = page.locator('input[type="file"]');
    this.templateNotFoundText = page.getByText(
      "Oops! We couldn't find that template.",
    );
    this.browseAvailableTemplatesLink = page.getByRole('link', {
      name: 'browsing available templates',
    });
    this.importErrorTitle = page.getByText('Failed to Import Dashboard');
    this.showErrorDetailsButton = page.getByRole('button', {
      name: 'Show Details',
    });
  }

  async uploadDashboardFile(content: string, filename = 'dashboard.json') {
    await this.fileUploadInput.setInputFiles({
      name: filename,
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
  }

  async gotoTemplates() {
    await this.page.goto('/dashboards/templates', { waitUntil: 'networkidle' });
  }

  async gotoImport(templateId?: string) {
    const url = templateId
      ? `/dashboards/import?template=${templateId}`
      : '/dashboards/import';
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }

  getTemplateImportButton(templateId: string) {
    return this.page.getByTestId(`import-template-${templateId}`);
  }

  async clickImportTemplate(templateId: string) {
    await this.getTemplateImportButton(templateId).click();
    await this.page.waitForURL(`**/dashboards/import?template=${templateId}`);
  }

  getSourceMappingSelect(index = 0) {
    return this.page.getByPlaceholder('Select a source').nth(index);
  }

  async selectSourceMapping(sourceName: string, index = 0) {
    await this.getSourceMappingSelect(index).click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();
  }

  getImportSuccessNotification() {
    return this.page.getByText('Import Successful!');
  }
}
