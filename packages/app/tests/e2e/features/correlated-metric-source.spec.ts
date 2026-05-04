import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

test.describe('Correlated Metric Source', { tag: ['@full-stack'] }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
  });

  test('should show alert when no correlated metric source is configured', async ({
    page,
  }) => {
    // Navigate to search page
    await searchPage.goto();

    // Select the source without metricSourceId
    await searchPage.selectSource('E2E K8s Logs No Metrics');

    // Search for K8s events that have k8s.pod.uid resource attribute
    await searchPage.performSearch('ResourceAttributes.k8s.pod.uid:*');

    // Click on first row to open side panel
    await searchPage.table.clickFirstRow();

    // Click the Infrastructure tab
    await searchPage.sidePanel.clickTab('infrastructure');

    // Assert the "No correlated metric source" alert is visible
    await expect(page.getByText('No correlated metric source')).toBeVisible();
    await expect(
      page.getByText('does not have a correlated metric source'),
    ).toBeVisible();
  });
});
