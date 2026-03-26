import { ServicesDashboardPage } from '../page-objects/ServicesDashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe('Services Dashboard', { tag: ['@services'] }, () => {
  let servicesPage: ServicesDashboardPage;

  test.beforeEach(async ({ page }) => {
    servicesPage = new ServicesDashboardPage(page);
    await servicesPage.goto();
    await servicesPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
  });

  test('should load the services dashboard page', async () => {
    await expect(servicesPage.pageContainer).toBeVisible();
  });

  test('should load HTTP tab charts without error', async () => {
    const errorRateChart = servicesPage.getChart(
      'services-request-error-rate-chart',
    );
    await expect(errorRateChart).toBeVisible();

    const throughputChart = servicesPage.getChart(
      'services-request-throughput-chart',
    );
    await expect(throughputChart).toBeVisible();
  });

  test('should display top endpoints table with data', async () => {
    await expect(servicesPage.topEndpointsTable).toBeVisible();

    const firstLink = servicesPage.topEndpointsTable.getByRole('link').first();
    await expect(firstLink).toBeVisible();
  });

  test('should show filter by SpanName using Lucene', async () => {
    await servicesPage.searchLucene('Order');

    // Should be filtered out
    const otherLink = await servicesPage.getTopEndpointsTableLink('AddItem');
    await expect(otherLink).toHaveCount(0);

    const orderLink =
      await servicesPage.getTopEndpointsTableLink('Order create');
    await expect(orderLink).toBeVisible();
  });

  test('should click an endpoint and navigate to filtered search', async ({
    page,
  }) => {
    const orderLink =
      await servicesPage.getTopEndpointsTableLink('Order create');
    await expect(orderLink).toBeVisible();

    const initialUrl = page.url();
    await orderLink.click();

    await expect(page).not.toHaveURL(initialUrl, { timeout: 10000 });
  });

  test('should filter endpoints with Lucene query and verify results', async () => {
    await servicesPage.searchLucene('AddItem');

    const addItemLink = await servicesPage.getTopEndpointsTableLink('AddItem');
    await expect(addItemLink).toBeVisible();

    const orderLink =
      await servicesPage.getTopEndpointsTableLink('Order create');
    await expect(orderLink).toHaveCount(0);

    const getLogsLink =
      await servicesPage.getTopEndpointsTableLink('GET /api/logs');
    await expect(getLogsLink).toHaveCount(0);
  });
});
