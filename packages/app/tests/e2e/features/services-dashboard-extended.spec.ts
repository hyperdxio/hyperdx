import { ServicesDashboardPage } from '../page-objects/ServicesDashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe('Services Dashboard Extended', { tag: ['@services'] }, () => {
  let servicesPage: ServicesDashboardPage;

  test.beforeEach(async ({ page }) => {
    servicesPage = new ServicesDashboardPage(page);
    await servicesPage.goto();
    await servicesPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
  });

  test('should display top endpoints table with data', async () => {
    const table = servicesPage.page.getByTestId('services-top-endpoints-table');
    await expect(table).toBeVisible();

    // Table should contain at least one endpoint link
    const firstLink = table.getByRole('link').first();
    await expect(firstLink).toBeVisible();
  });

  test('should display throughput chart', async () => {
    const throughputChart = servicesPage.getChart(
      'services-request-throughput-chart',
    );
    await expect(throughputChart).toBeVisible();
  });

  test('should click an endpoint and navigate to filtered search', async ({
    page,
  }) => {
    const orderLink =
      await servicesPage.getTopEndpointsTableLink('Order create');
    await expect(orderLink).toBeVisible();

    const initialUrl = page.url();
    await orderLink.click();
    await page.waitForLoadState('networkidle');

    // URL should change after clicking the endpoint link
    await expect(page).not.toHaveURL(initialUrl);
  });

  test('should filter endpoints with Lucene query and verify results', async () => {
    await servicesPage.searchLucene('AddItem');

    // The matching endpoint should be visible
    const addItemLink = await servicesPage.getTopEndpointsTableLink('AddItem');
    await expect(addItemLink).toBeVisible();

    // Other endpoints should not be visible
    const orderLink =
      await servicesPage.getTopEndpointsTableLink('Order create');
    await expect(orderLink).toHaveCount(0);

    const getLogsLink =
      await servicesPage.getTopEndpointsTableLink('GET /api/logs');
    await expect(getLogsLink).toHaveCount(0);
  });
});
