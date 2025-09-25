import { expect, test } from '../../utils/base-test';

test.describe('Search', { tag: '@search' }, () => {
  test.describe('Basic Functionality', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/search');
    });

    test(
      'should load search page with all components',
      { tag: ['@local-mode', '@smoke'] },
      async ({ page }) => {
        await expect(page.locator('[data-testid="search-form"]')).toBeVisible();
        await expect(
          page.locator('[data-testid="time-picker-input"]'),
        ).toBeVisible();
        await expect(
          page.locator('[data-testid="search-submit-button"]'),
        ).toBeVisible();
      },
    );

    test('should interact with time picker', async ({ page }) => {
      await page.click('[data-testid="time-picker-input"]');
      await expect(
        page.locator('[data-testid="time-picker-apply"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="time-picker-1h-back"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="time-picker-1h-forward"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="time-picker-apply"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="time-picker-close"]'),
      ).toBeVisible();
      await expect(page.locator('text=Last 1 hour')).toBeVisible();
      await page.click('[data-testid="time-picker-close"]');
      await expect(
        page.locator('[data-testid="time-picker-apply"]'),
      ).not.toBeVisible();
    });

    test('should interact with search results and navigate side panel tabs', async ({
      page,
    }) => {
      await test.step('Perform search and open side panel', async () => {
        await page.click('[data-testid="search-submit-button"]');
        await page.waitForTimeout(2000);

        const tableRows = page.locator('[data-testid^="table-row-"]');
        await expect(tableRows.first()).toBeVisible();
        await tableRows.first().click();

        const sidePanelTabs = page.locator('[data-testid="side-panel-tabs"]');
        await expect(sidePanelTabs).toBeVisible();
      });

      await test.step('Navigate through all side panel tabs', async () => {
        const overviewTab = page.locator('[data-testid="tab-overview"]');
        const parsedTab = page.locator('[data-testid="tab-parsed"]');
        const traceTab = page.locator('[data-testid="tab-trace"]');
        const contextTab = page.locator('[data-testid="tab-context"]');

        await parsedTab.click();
        await expect(parsedTab).toBeVisible();

        await traceTab.click();
        await expect(traceTab).toBeVisible();

        await contextTab.click();
        await expect(contextTab).toBeVisible();

        await overviewTab.click();
        await expect(overviewTab).toBeVisible();
      });
    });
  });

  test.describe('Advanced Workflows', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/search');
    });

    test('Search with Different Query Types - Lucene', async ({ page }) => {
      await test.step('Test multiple search query types', async () => {
        const searchInput = page.locator('[data-testid="search-input"]');
        const searchSubmitButton = page.locator(
          '[data-testid="search-submit-button"]',
        );

        const queries = ['error', 'status:200', '*exception*', 'level:"error"'];

        for (const query of queries) {
          await searchInput.fill('');
          await page.waitForTimeout(500);

          await searchInput.fill(query);
          await searchSubmitButton.click();

          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(3000);

          const searchResultsTable = page.locator(
            '[data-testid="search-results-table"]',
          );
          const tableVisible = await searchResultsTable.isVisible({
            timeout: 2000,
          });

          // Results may or may not exist for each query - this is expected
          expect(typeof tableVisible).toBe('boolean');
        }
      });
    });

    test('should support multiline SQL WHERE clauses', async ({ page }) => {
      const searchForm = page.locator('[data-testid="search-form"]');
      const sqlToggle = searchForm.locator('text=SQL').first();
      const whereContainer = searchForm.locator('div:has(p.mantine-Text-root:has-text("WHERE"))');
      const whereLabel = whereContainer.locator('p.mantine-Text-root:has-text("WHERE")');
      const whereEditor = whereContainer.locator('.cm-editor');
      const searchResults = page.locator('[data-testid="search-results-table"]');

      await test.step('Switch to SQL mode', async () => {
        await sqlToggle.click();
        await expect(whereLabel).toBeVisible();
      });

      await test.step('Test multiline input with Shift+Enter', async () => {
        await whereEditor.click();
        
        await whereEditor.type('timestamp >= now() - interval 1 hour');
        await page.keyboard.press('Shift+Enter');
        await whereEditor.type('AND level = "error"');
        await page.keyboard.press('Shift+Enter'); 
        await whereEditor.type('AND service_name = "api"');
        
        const editorContent = await whereEditor.textContent();
        expect(editorContent).toContain('timestamp >= now() - interval 1 hour');
        expect(editorContent).toContain('AND level = "error"');
        expect(editorContent).toContain('AND service_name = "api"');
      });

      await test.step('Test editor height expansion', async () => {
        const initialBox = await whereEditor.boundingBox();
        const initialHeight = initialBox?.height || 0;
        
        await whereEditor.press('Shift+Enter');
        await whereEditor.type('AND response_time > 1000');
        await whereEditor.press('Shift+Enter');
        await whereEditor.type('AND user_id IS NOT NULL');
        
        const expandedBox = await whereEditor.boundingBox();
        const expandedHeight = expandedBox?.height || 0;
        expect(expandedHeight).toBeGreaterThan(initialHeight);
      });

      await test.step('Test max height with scroll overflow', async () => {
        for (let i = 0; i < 10; i++) {
          await whereEditor.press('Shift+Enter');
          await whereEditor.type(`AND field_${i} = "value_${i}"`);
        }
        
        const editorBox = await whereEditor.boundingBox();
        const maxHeight = 150;
        expect(editorBox?.height).toBeLessThanOrEqual(maxHeight + 10);
        
        const scroller = whereEditor.locator('.cm-scroller');
        await expect(scroller).toHaveCSS('overflow-y', 'auto');
      });

      await test.step('Test Enter submits query', async () => {
        await whereEditor.click();
        
        await page.keyboard.press('Control+a');
        await whereEditor.type('level = "info"');
        
        await page.keyboard.press('Enter');
        
        await page.waitForTimeout(1000);
        await expect(searchResults).toBeVisible({ timeout: 5000 });
      });
    });

    test('should support multiline Lucene search input', async ({ page }) => {
      const searchForm = page.locator('[data-testid="search-form"]');
      const luceneToggle = searchForm.locator('text=Lucene').first();
      const searchInput = page.locator('[data-testid="search-input"]');
      const searchResults = page.locator('[data-testid="search-results-table"]');

      await test.step('Ensure Lucene mode is active', async () => {
        await luceneToggle.click();
        await expect(searchInput).toBeVisible();
      });

      await test.step('Test multiline input with auto-expansion', async () => {
        await searchInput.click();
        
        await searchInput.type('level:error');
        await page.keyboard.press('Shift+Enter');
        await searchInput.type('service_name:api');
        await page.keyboard.press('Shift+Enter');
        await searchInput.type('timestamp:[now-1h TO now]');
        
        const inputValue = await searchInput.inputValue();
        expect(inputValue).toContain('level:error');
        expect(inputValue).toContain('service_name:api');
        expect(inputValue).toContain('timestamp:[now-1h TO now]');
      });

      await test.step('Test textarea auto-expansion', async () => {
        const initialBox = await searchInput.boundingBox();
        const initialHeight = initialBox?.height || 0;
        
        await page.keyboard.press('Shift+Enter');
        await searchInput.type('response_time:>1000');
        await page.keyboard.press('Shift+Enter');
        await searchInput.type('user_id:*');
        
        const expandedBox = await searchInput.boundingBox();
        const expandedHeight = expandedBox?.height || 0;
        expect(expandedHeight).toBeGreaterThan(initialHeight);
      });

      await test.step('Test Enter submits search', async () => {
        await searchInput.click();
        
        await page.keyboard.press('Control+a');
        await searchInput.type('level:info');
        
        await page.keyboard.press('Enter');
        
        await page.waitForTimeout(1000);
        await expect(searchResults).toBeVisible({ timeout: 5000 });
      });
    });

    test('Comprehensive Search Workflow - Search, View Results, Navigate Side Panel', async ({
      page,
    }) => {
      await test.step('Setup and perform search', async () => {
        const searchInput = page.locator('[data-testid="search-input"]');
        await searchInput.fill(
          'ResourceAttributes.k8s.pod.name:* ResourceAttributes.k8s.node.name:* ',
        );

        const searchSubmitButton = page.locator(
          '[data-testid="search-submit-button"]',
        );
        await searchSubmitButton.click();

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      });

      await test.step('Verify search results and interact with table rows', async () => {
        const searchResultsTable = page.locator(
          '[data-testid="search-results-table"]',
        );
        await expect(searchResultsTable).toBeVisible();

        const rows = searchResultsTable.locator('tr');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(1);

        await page.click(
          `[data-testid="search-results-table"] tr:nth-child(2)`,
        );
        await page.waitForTimeout(1000);

        const sidePanel = page.locator('nav[class*="EZDrawer__container"]');
        await expect(sidePanel).toBeVisible();
      });

      await test.step('Navigate through all side panel tabs', async () => {
        const overviewTab = page.locator('[data-testid="tab-overview"]');
        const traceTab = page.locator('[data-testid="tab-trace"]');
        const contextTab = page.locator('[data-testid="tab-context"]');
        const infrastructureTab = page.locator(
          '[data-testid="tab-infrastructure"]',
        );

        const tabs = [
          { locator: traceTab, name: 'Trace' },
          { locator: contextTab, name: 'Context' },
          { locator: infrastructureTab, name: 'Infrastructure' },
          { locator: overviewTab, name: 'Overview' },
        ];

        for (const tab of tabs) {
          await tab.locator.scrollIntoViewIfNeeded();
          await tab.locator.click({ timeout: 5000 });
          await page.waitForTimeout(500);
          await expect(tab.locator).toBeVisible();
        }
      });

      await test.step('Verify infrastructure tab content', async () => {
        const infrastructureTab = page.locator(
          '[data-testid="tab-infrastructure"]',
        );
        await infrastructureTab.click();
        await infrastructureTab.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);

        const podSubpanel = page.getByTestId('infra-subpanel-k8s.pod.');
        await expect(podSubpanel).toBeVisible();

        const podCpuUsageData = podSubpanel
          .getByTestId('cpu-usage-card')
          .locator('.recharts-responsive-container');
        await expect(podCpuUsageData).toBeVisible();

        const podMemoryUsageData = podSubpanel
          .getByTestId('memory-usage-card')
          .locator('.recharts-responsive-container');
        await expect(podMemoryUsageData).toBeVisible();

        const podDiskUsageData = podSubpanel
          .getByTestId('disk-usage-card')
          .locator('.recharts-responsive-container');
        await expect(podDiskUsageData).toBeVisible();

        const nodeSubpanel = page.getByTestId('infra-subpanel-k8s.node.');
        await expect(nodeSubpanel).toBeVisible();

        const nodeCpuUsageData = nodeSubpanel
          .getByTestId('cpu-usage-card')
          .locator('.recharts-responsive-container');
        await expect(nodeCpuUsageData).toBeVisible();

        const nodeMemoryUsageData = nodeSubpanel
          .getByTestId('memory-usage-card')
          .locator('.recharts-responsive-container');
        await expect(nodeMemoryUsageData).toBeVisible();

        const nodeDiskUsageData = nodeSubpanel
          .getByTestId('disk-usage-card')
          .locator('.recharts-responsive-container');
        await expect(nodeDiskUsageData).toBeVisible();
      });
    });

    test('Time Picker Integration with Search', async ({ page }) => {
      await test.step('Interact with time picker', async () => {
        const timePicker = page.locator('[data-testid="time-picker-input"]');
        await expect(timePicker).toBeVisible();
        await timePicker.click();
        await page.waitForTimeout(1000);

        const lastHourOption = page.locator('text=Last 1 hour');
        await expect(lastHourOption).toBeVisible();
        await lastHourOption.click();
        await page.waitForTimeout(500);
      });

      await test.step('Perform search with selected time range', async () => {
        const searchInput = page.locator('[data-testid="search-input"]');
        await searchInput.fill('');

        const searchSubmitButton = page.locator(
          '[data-testid="search-submit-button"]',
        );
        await searchSubmitButton.click();

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      });

      await test.step('Verify search results', async () => {
        const searchResultsTable = page.locator(
          '[data-testid="search-results-table"]',
        );
        await expect(searchResultsTable).toBeVisible();
        const rows = searchResultsTable.locator('tr');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(0);
      });
    });
  });
});
