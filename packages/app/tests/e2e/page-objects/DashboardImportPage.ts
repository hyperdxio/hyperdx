/**
 * DashboardImportPage - Page object for dashboard template browsing and import
 * Covers the /dashboards/templates page and the /dashboards/import page
 */
import { Locator, Page } from '@playwright/test';

/**
 * Mapping type labels rendered in the Step 2 table's "Mapping type" column.
 * Each row is keyed by (tile/filter name, mapping type).
 */
export type MappingType =
  | 'Data source'
  | 'Data connection'
  | 'On click - search source'
  | 'On click - dashboard'
  | 'Applies to sources'
  | 'Data sources';

/** Test ID prefixes of the multiselect mapping types, keyed by mapping type. */
const MULTI_SELECT_TEST_ID_PREFIXES: Partial<Record<MappingType, string>> = {
  'Applies to sources': 'filter-applies-to-mapping-',
  'Data sources': 'filter-adhoc-sources-mapping-',
};

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
    this.dashboardNameInput = page.getByLabel('Dashboard name');
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

  /**
   * Upload a JSON template file via the dropzone's hidden file input.
   */
  async uploadTemplateFile(filePath: string) {
    await this.page.locator('input[type="file"]').setInputFiles(filePath);
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

  /**
   * Locate the Step 2 mapping row for (inputName, mappingType). The row
   * structure is: [Tile/Filter name, Mapping Type, From, To].
   */
  getMappingRow(inputName: string, mappingType: MappingType) {
    return this.page
      .locator('tbody tr')
      .filter({ hasText: inputName })
      .filter({ hasText: mappingType });
  }

  /**
   * Select a value in the "To" column of a mapping row. Pass the exact
   * option name (source / connection / dashboard name).
   */
  async selectMapping(
    inputName: string,
    mappingType: MappingType,
    optionName: string,
  ) {
    const row = this.getMappingRow(inputName, mappingType);
    const testIdPrefix = MULTI_SELECT_TEST_ID_PREFIXES[mappingType];
    if (testIdPrefix) {
      await row.getByTestId(new RegExp(`^${testIdPrefix}`)).click();
      await this.page
        .getByRole('option', { name: optionName, exact: true })
        .click();
      // Close the dropdown so it doesn't intercept future clicks.
      await this.page.keyboard.press('Escape');
      return;
    }
    const placeholder =
      mappingType === 'Data connection'
        ? 'Select a connection'
        : mappingType === 'On click - dashboard'
          ? 'Select a dashboard'
          : 'Select a source';
    await row.getByPlaceholder(placeholder).click();
    await this.page
      .getByRole('option', { name: optionName, exact: true })
      .click();
  }

  /**
   * Clear a mapping row's selection by re-clicking the option that is already
   * selected (Mantine's Select deselects on a second click).
   */
  async clearMapping(
    inputName: string,
    mappingType: MappingType,
    selectedOptionName: string,
  ) {
    await this.getMappingRow(inputName, mappingType)
      .getByPlaceholder('Select a source')
      .click();
    await this.page
      .getByRole('option', { name: selectedOptionName, exact: true })
      .click();
  }

  /**
   * The validation error rendered on a mapping row whose mapping is required
   * but left unpicked. The exact wording is asserted in the unit tests; here
   * the row it belongs to is what matters.
   */
  getMappingRowError(
    inputName: string,
    mappingType: MappingType = 'Data source',
  ) {
    return this.getMappingRow(inputName, mappingType).getByText(
      /^Select (?:a|at least one) (?:source|connection) for this (?:tile|filter)$/,
    );
  }

  getImportSuccessNotification() {
    return this.page.getByText('Import Successful!');
  }

  /** The non-blocking warning shown when imported saved filter values have invalid conditions. */
  getSavedFilterValuesWarning() {
    return this.page.getByTestId('import-warning-saved-filter-values');
  }

  /** The non-blocking warning shown when imported dashboard filters have invalid value queries. */
  getFilterQueriesWarning() {
    return this.page.getByTestId('import-warning-filter-queries');
  }

  /** The non-blocking warning shown when the imported dashboard's saved query is invalid. */
  getSavedQueryWarning() {
    return this.page.getByTestId('import-warning-saved-query');
  }

  /** Expand the "Show Details" section of one of the import warning/error blocks. */
  async showDetails(warning: Locator) {
    await warning.getByRole('button', { name: 'Show Details' }).click();
  }
}
