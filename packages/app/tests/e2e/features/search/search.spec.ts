import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.describe('Basic Functionality', () => {
    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
    });

    test(
      'should load search page with all components',
      { tag: ['@local-mode', '@smoke'] },
      async () => {
        // All assertions use page object getters
        await expect(searchPage.form).toBeVisible();
        await expect(searchPage.timePicker.input).toBeVisible();
        await expect(searchPage.submitButton).toBeVisible();
      },
    );

    test('should interact with time picker', async () => {
      // Use TimePickerComponent methods
      await searchPage.timePicker.open();

      // Assertions only in spec
      await expect(searchPage.timePicker.applyButton).toBeVisible();
      await expect(searchPage.timePicker.closeButton).toBeVisible();

      // Verify time range option
      await expect(searchPage.page.locator('text=Last 1 hour')).toBeVisible();

      // Close time picker using component method
      await searchPage.timePicker.close();

      // Verify it closed using web-first assertion
      await expect(searchPage.timePicker.applyButton).toBeHidden();
    });

    test('should interact with search results and navigate side panel tabs', async () => {
      await test.step('Perform search and open side panel', async () => {
        // Use page object method - no waitForTimeout!
        await searchPage.submitEmptySearch();

        // Use table component
        await expect(searchPage.table.firstRow).toBeVisible();
        await searchPage.table.clickFirstRow();

        // Verify side panel opens
        await expect(searchPage.sidePanel.tabs).toBeVisible();
      });

      await test.step('Navigate through all side panel tabs', async () => {
        const tabs = ['parsed', 'trace', 'context', 'overview'];

        // Use side panel component to navigate tabs
        for (const tabName of tabs) {
          await searchPage.sidePanel.clickTab(tabName);
          await expect(searchPage.sidePanel.getTab(tabName)).toBeVisible();
        }
      });
    });
  });

  test.describe('Advanced Workflows', () => {
    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
    });

    test('Search with Different Query Types - Lucene', async () => {
      await test.step('Test multiple search query types', async () => {
        const queries = [
          'Order',
          'ServiceName:"CartService"',
          '*Order*',
          'SeverityText:"info"',
        ];

        for (const query of queries) {
          // Use page object methods for interactions
          await searchPage.clearSearch();
          await searchPage.performSearch(query);
        }
      });
    });

    test('Comprehensive Search Workflow - Search, View Results, Navigate Side Panel', async () => {
      await test.step('Setup and perform search', async () => {
        await searchPage.performSearch('ResourceAttributes.k8s.pod.name:*');
      });

      await test.step('Verify search results and interact with table rows', async () => {
        const resultsTable = searchPage.getSearchResultsTable();
        await expect(resultsTable).toBeVisible();

        // Click second row (index 1) using component method
        await searchPage.table.clickRow(1);

        // Verify side panel opens
        await expect(searchPage.sidePanel.container).toBeVisible();
      });

      await test.step('Navigate through all side panel tabs', async () => {
        const tabs = ['trace', 'context', 'infrastructure', 'overview'];

        // Use side panel component with proper waiting
        for (const tabName of tabs) {
          const tab = searchPage.sidePanel.getTab(tabName);
          // Wait for tab to exist before scrolling (fail fast if missing)
          await tab.waitFor({
            state: 'visible',
            timeout: searchPage.defaultTimeout,
          });
          await tab.scrollIntoViewIfNeeded();
          await tab.click({ timeout: searchPage.defaultTimeout });
          await expect(tab).toBeVisible();
        }
      });

      await test.step('Verify infrastructure tab content', async () => {
        // Click infrastructure tab using component
        await searchPage.sidePanel.clickTab('infrastructure');

        // Use infrastructure component for K8s metrics
        const podMetrics =
          await searchPage.infrastructure.verifyStandardMetrics('k8s.pod.');
        await expect(podMetrics.subpanel).toBeVisible();
        await expect(podMetrics.cpuUsage).toBeVisible();
        await expect(podMetrics.memoryUsage).toBeVisible();
        await expect(podMetrics.diskUsage).toBeVisible();

        const nodeMetrics =
          await searchPage.infrastructure.verifyStandardMetrics('k8s.node.');
        await expect(nodeMetrics.subpanel).toBeVisible();
        await expect(nodeMetrics.cpuUsage).toBeVisible();
        await expect(nodeMetrics.memoryUsage).toBeVisible();
        await expect(nodeMetrics.diskUsage).toBeVisible();
      });
    });

    test('Time Picker Integration with Search', async () => {
      await test.step('Interact with time picker', async () => {
        await expect(searchPage.timePicker.input).toBeVisible();

        // Use component method to select time range
        await searchPage.timePicker.selectRelativeTime('Last 1 hour');
      });

      await test.step('Perform search with selected time range', async () => {
        // Clear and submit using page object methods
        await searchPage.clearSearch();
        await searchPage.performSearch('Order');
      });

      await test.step('Verify search results', async () => {
        const resultsTable = searchPage.getSearchResultsTable();
        await expect(resultsTable).toBeVisible();

        // Use table component to verify rows exist
        const rows = searchPage.table.getRows();
        // Verify at least one row exists (count can vary based on data)
        await expect(rows.first()).toBeVisible();
      });
    });

    test('Histogram drag-to-zoom preserves custom SELECT columns', async () => {
      const CUSTOM_SELECT =
        'Timestamp, ServiceName, Body as message, SeverityText';

      await test.step('Perform initial search', async () => {
        await expect(searchPage.form).toBeVisible();
        await searchPage.submitEmptySearch();
      });

      await test.step('Setup custom SELECT columns', async () => {
        // Use page object method for SELECT editor
        await searchPage.setCustomSELECT(CUSTOM_SELECT);
      });

      await test.step('Search with custom columns and wait for histogram', async () => {
        await searchPage.submitEmptySearch();

        // Wait for histogram using page object getter
        await expect(searchPage.getHistogram()).toBeVisible();
      });

      await test.step('Drag on histogram to select time range', async () => {
        // Use page object method for histogram interaction
        await searchPage.dragHistogramToZoom(0.25, 0.75);
      });

      await test.step('Verify custom SELECT columns are preserved', async () => {
        // Check URL parameters
        const url = searchPage.page.url();
        expect(url, 'URL should contain select parameter').toContain('select=');
        expect(url, 'URL should contain alias "message"').toContain('message');

        // Verify SELECT editor content using page object
        const selectEditor = searchPage.getSELECTEditor();
        await expect(selectEditor).toBeVisible();
        const selectValue = await selectEditor.textContent();

        expect(selectValue, 'SELECT should contain alias').toContain(
          'Body as message',
        );
        expect(selectValue, 'SELECT should contain SeverityText').toContain(
          'SeverityText',
        );
      });

      await test.step('Verify search results are still displayed', async () => {
        const resultsTable = searchPage.getSearchResultsTable();
        await expect(
          resultsTable,
          'Search results table should be visible',
        ).toBeVisible();

        const rows = searchPage.table.getRows();
        await expect(rows.first()).toBeVisible();
      });
    });
  });
});
