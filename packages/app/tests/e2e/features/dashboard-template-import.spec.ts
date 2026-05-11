import fs from 'fs';
import os from 'os';
import path from 'path';
import { Page } from '@playwright/test';

import { DashboardImportPage } from '../page-objects/DashboardImportPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';

/**
 * Fetch a single dashboard by id. The API only exposes GET /dashboards
 * (list); fetching by id means filtering the list.
 */
async function fetchDashboardById(
  page: Page,
  dashboardId: string,
): Promise<any> {
  const response = await page.request.get(`${getApiUrl()}/dashboards`);
  if (!response.ok()) {
    throw new Error(
      `Failed to fetch dashboards: ${response.status()} ${response.statusText()}`,
    );
  }
  const dashboards = await response.json();
  const dashboard = dashboards.find((d: any) => d.id === dashboardId);
  if (!dashboard) {
    throw new Error(`Dashboard ${dashboardId} not found`);
  }
  return dashboard;
}

/** Write a template object to a temp JSON file and return its path. */
function writeTempTemplate(template: unknown): string {
  const filePath = path.join(
    os.tmpdir(),
    `e2e-dashboard-template-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(template));
  return filePath;
}

/**
 * Build a minimal single-tile dashboard template whose tile carries the given
 * onClick config. The tile's `source` is set to a unique name that won't
 * auto-match any workspace source, so the test explicitly drives the mapping.
 */
function makeTemplateWithOnClick({
  dashboardName,
  tileName,
  tileSourceName,
  onClick,
}: {
  dashboardName: string;
  tileName: string;
  tileSourceName: string;
  onClick: Record<string, unknown>;
}) {
  return {
    version: '0.1.0',
    name: dashboardName,
    tiles: [
      {
        id: 'tile-1',
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        config: {
          name: tileName,
          source: tileSourceName,
          displayType: 'number',
          granularity: 'auto',
          select: [{ aggFn: 'count', valueExpression: '' }],
          where: '',
          whereLanguage: 'sql',
          onClick,
        },
      },
    ],
  };
}

test.describe('Dashboard Template Import', { tag: ['@dashboard'] }, () => {
  let dashboardsListPage: DashboardsListPage;
  let dashboardImportPage: DashboardImportPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
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
    'should show a friendly error when the imported file has duplicate tile IDs',
    { tag: '@full-stack' },
    async ({ page }) => {
      const duplicateId = 'duplicate-tile-id';
      const dashboardFile = {
        version: '0.1.0',
        name: 'Duplicate Tile Dashboard',
        tiles: [
          {
            id: duplicateId,
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            config: {
              name: 'Tile A',
              source: 'Logs',
              displayType: 'number',
              select: [{ aggFn: 'count', valueExpression: '' }],
              where: '',
              whereLanguage: 'sql',
            },
          },
          {
            id: duplicateId,
            x: 6,
            y: 0,
            w: 6,
            h: 4,
            config: {
              name: 'Tile B',
              source: 'Logs',
              displayType: 'number',
              select: [{ aggFn: 'count', valueExpression: '' }],
              where: '',
              whereLanguage: 'sql',
            },
          },
        ],
      };

      await test.step('Navigate to the dashboard file import page', async () => {
        await dashboardImportPage.gotoImport();
        await expect(dashboardImportPage.fileUploadDropzone).toBeVisible();
      });

      await test.step('Upload a dashboard file with duplicate tile IDs', async () => {
        await dashboardImportPage.uploadDashboardFile(
          JSON.stringify(dashboardFile),
        );
      });

      await test.step('Verify the import error is shown and the mapping step is not reached', async () => {
        await expect(dashboardImportPage.importErrorTitle).toBeVisible();
        await expect(dashboardImportPage.mappingStepHeading).toBeHidden();
      });

      await test.step('Expand error details and verify the duplicate tile ID is reported', async () => {
        await dashboardImportPage.showErrorDetailsButton.click();
        await expect(
          page.getByText(`Duplicate tile ID: ${duplicateId}`),
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

  test(
    'should map tile onClick search source to the selected source id on import',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const dashboardName = `E2E Import OnClick Search ${ts}`;
      const tileName = `Log Count ${ts}`;
      // Use names that do NOT match any workspace source so auto-mapping
      // stays empty and the test drives every select explicitly.
      const templatePath = writeTempTemplate(
        makeTemplateWithOnClick({
          dashboardName,
          tileName,
          tileSourceName: `TemplateLogs ${ts}`,
          onClick: {
            type: 'search',
            target: { mode: 'id', id: `TemplateSearchLogs ${ts}` },
            whereLanguage: 'sql',
          },
        }),
      );

      await test.step('Upload the template JSON and wait for mapping step', async () => {
        await dashboardImportPage.gotoImport();
        await dashboardImportPage.uploadTemplateFile(templatePath);
        await expect(dashboardImportPage.mappingStepHeading).toBeVisible();
        await expect(dashboardImportPage.dashboardNameInput).toHaveValue(
          dashboardName,
        );
      });

      await test.step('Verify both tile source and onClick source rows are rendered', async () => {
        await expect(
          dashboardImportPage.getMappingRow(tileName, 'Data Source'),
        ).toBeVisible();
        await expect(
          dashboardImportPage.getMappingRow(
            tileName,
            'On Click - Search Source',
          ),
        ).toBeVisible();
      });

      await test.step('Verify the onClick source dropdown only lists log and trace sources', async () => {
        const onClickRow = dashboardImportPage.getMappingRow(
          tileName,
          'On Click - Search Source',
        );
        await onClickRow.getByPlaceholder('Select a source').click();
        await expect(
          page.getByRole('option', { name: DEFAULT_LOGS_SOURCE_NAME }),
        ).toBeVisible();
        await expect(
          page.getByRole('option', { name: DEFAULT_TRACES_SOURCE_NAME }),
        ).toBeVisible();
        // Metric / session sources must not appear in the onClick search list.
        await expect(
          page.getByRole('option', { name: DEFAULT_METRICS_SOURCE_NAME }),
        ).toBeHidden();
        await page.keyboard.press('Escape');
      });

      await test.step('Map the tile source and onClick search source', async () => {
        await dashboardImportPage.selectMapping(
          tileName,
          'Data Source',
          DEFAULT_METRICS_SOURCE_NAME,
        );
        await dashboardImportPage.selectMapping(
          tileName,
          'On Click - Search Source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
      });

      await test.step('Finish import and wait for new dashboard', async () => {
        await dashboardImportPage.finishImportButton.click();
        await expect(
          dashboardImportPage.getImportSuccessNotification(),
        ).toBeVisible();
        await page.waitForURL(/\/dashboards\/[a-f0-9]{24}/);
      });

      await test.step('Verify imported tile onClick resolves to the selected logs source id', async () => {
        const logSources = await getSources(page, 'log');
        const logsSourceId = logSources.find(
          (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
        ).id;

        const dashboardId = dashboardPage.getCurrentDashboardId();
        const dashboard = await fetchDashboardById(page, dashboardId);
        expect(dashboard.name).toBe(dashboardName);
        expect(dashboard.tiles).toHaveLength(1);
        expect(dashboard.tiles[0].config.onClick).toMatchObject({
          type: 'search',
          target: { mode: 'id', id: logsSourceId },
          whereLanguage: 'sql',
        });
      });
    },
  );

  test(
    'should map tile onClick dashboard to the selected dashboard id on import',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const targetDashboardName = `E2E OnClick Target ${ts}`;
      const sourceDashboardName = `E2E Import OnClick Dashboard ${ts}`;
      const tileName = `Trace Count ${ts}`;

      // Pre-create the target dashboard — the mapping dropdown only lists
      // dashboards that already exist in the workspace.
      let targetDashboardId = '';
      await test.step('Create a target dashboard for the onClick link', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.editDashboardName(targetDashboardName);
        targetDashboardId = dashboardPage.getCurrentDashboardId();
      });

      const templatePath = writeTempTemplate(
        makeTemplateWithOnClick({
          dashboardName: sourceDashboardName,
          tileName,
          tileSourceName: `TemplateTraces ${ts}`,
          onClick: {
            type: 'dashboard',
            target: { mode: 'id', id: `TemplateTargetDash ${ts}` },
            whereLanguage: 'sql',
          },
        }),
      );

      await test.step('Upload the template JSON and wait for mapping step', async () => {
        await dashboardImportPage.gotoImport();
        await dashboardImportPage.uploadTemplateFile(templatePath);
        await expect(dashboardImportPage.mappingStepHeading).toBeVisible();
      });

      await test.step('Verify the onClick dashboard row is rendered', async () => {
        await expect(
          dashboardImportPage.getMappingRow(tileName, 'On Click - Dashboard'),
        ).toBeVisible();
      });

      await test.step('Map the tile source and onClick target dashboard', async () => {
        await dashboardImportPage.selectMapping(
          tileName,
          'Data Source',
          DEFAULT_METRICS_SOURCE_NAME,
        );
        await dashboardImportPage.selectMapping(
          tileName,
          'On Click - Dashboard',
          targetDashboardName,
        );
      });

      await test.step('Finish import and wait for new dashboard', async () => {
        await dashboardImportPage.finishImportButton.click();
        await expect(
          dashboardImportPage.getImportSuccessNotification(),
        ).toBeVisible();
        await page.waitForURL(/\/dashboards\/[a-f0-9]{24}/);
      });

      await test.step('Verify imported tile onClick resolves to the target dashboard id', async () => {
        const importedDashboardId = dashboardPage.getCurrentDashboardId();
        expect(importedDashboardId).not.toBe(targetDashboardId);

        const dashboard = await fetchDashboardById(page, importedDashboardId);
        expect(dashboard.name).toBe(sourceDashboardName);
        expect(dashboard.tiles).toHaveLength(1);
        expect(dashboard.tiles[0].config.onClick).toMatchObject({
          type: 'dashboard',
          target: { mode: 'id', id: targetDashboardId },
          whereLanguage: 'sql',
        });
      });
    },
  );

  test(
    'should propagate a tile source selection to the onClick source when they share a name',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const dashboardName = `E2E Import OnClick Propagation ${ts}`;
      const tileName = `Shared Source Tile ${ts}`;
      const sharedName = `SharedLogs ${ts}`;

      // The tile's source and the onClick target share the same name in the
      // template — picking the tile source should cascade to the onClick row.
      const templatePath = writeTempTemplate(
        makeTemplateWithOnClick({
          dashboardName,
          tileName,
          tileSourceName: sharedName,
          onClick: {
            type: 'search',
            target: { mode: 'id', id: sharedName },
            whereLanguage: 'sql',
          },
        }),
      );

      await test.step('Upload the template JSON and wait for mapping step', async () => {
        await dashboardImportPage.gotoImport();
        await dashboardImportPage.uploadTemplateFile(templatePath);
        await expect(dashboardImportPage.mappingStepHeading).toBeVisible();
      });

      await test.step('Select only the tile Data Source mapping', async () => {
        await dashboardImportPage.selectMapping(
          tileName,
          'Data Source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
      });

      await test.step('Verify the onClick source select auto-filled with the same source', async () => {
        const onClickRow = dashboardImportPage.getMappingRow(
          tileName,
          'On Click - Search Source',
        );
        await expect(
          onClickRow.getByPlaceholder('Select a source'),
        ).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);
      });

      await test.step('Finish import and verify onClick resolved to the same source id', async () => {
        await dashboardImportPage.finishImportButton.click();
        await expect(
          dashboardImportPage.getImportSuccessNotification(),
        ).toBeVisible();
        await page.waitForURL(/\/dashboards\/[a-f0-9]{24}/);

        const logSources = await getSources(page, 'log');
        const logsSourceId = logSources.find(
          (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
        ).id;

        const dashboardId = dashboardPage.getCurrentDashboardId();
        const dashboard = await fetchDashboardById(page, dashboardId);
        expect(dashboard.tiles[0].config.source).toBe(logsSourceId);
        expect(dashboard.tiles[0].config.onClick).toMatchObject({
          type: 'search',
          target: { mode: 'id', id: logsSourceId },
        });
      });
    },
  );

  test(
    'should drop an unmapped onClick from the imported tile',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const dashboardName = `E2E Import OnClick Drop ${ts}`;
      const tileName = `Unmapped OnClick ${ts}`;

      // Tile source and onClick target use different names so the onClick
      // stays unmapped when we only select the tile source.
      const templatePath = writeTempTemplate(
        makeTemplateWithOnClick({
          dashboardName,
          tileName,
          tileSourceName: `TemplateMetrics ${ts}`,
          onClick: {
            type: 'search',
            target: { mode: 'id', id: `TemplateSearchLogs ${ts}` },
            whereLanguage: 'sql',
          },
        }),
      );

      await test.step('Upload the template and wait for mapping step', async () => {
        await dashboardImportPage.gotoImport();
        await dashboardImportPage.uploadTemplateFile(templatePath);
        await expect(dashboardImportPage.mappingStepHeading).toBeVisible();
      });

      await test.step('Only map the tile Data Source, leave onClick source empty', async () => {
        await dashboardImportPage.selectMapping(
          tileName,
          'Data Source',
          DEFAULT_METRICS_SOURCE_NAME,
        );
      });

      await test.step('Finish import', async () => {
        await dashboardImportPage.finishImportButton.click();
        await expect(
          dashboardImportPage.getImportSuccessNotification(),
        ).toBeVisible();
        await page.waitForURL(/\/dashboards\/[a-f0-9]{24}/);
      });

      await test.step('Verify the onClick was dropped from the imported tile', async () => {
        const dashboardId = dashboardPage.getCurrentDashboardId();
        const dashboard = await fetchDashboardById(page, dashboardId);
        expect(dashboard.tiles).toHaveLength(1);
        expect(dashboard.tiles[0].config.onClick).toBeUndefined();
      });
    },
  );
});
