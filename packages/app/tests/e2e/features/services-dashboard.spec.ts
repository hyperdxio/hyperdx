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

  test('should show filter by SpanName using Lucene', async () => {
    await servicesPage.searchLucene('Order');

    // Should be filtered out
    const otherLink = servicesPage.getTopEndpointsTableLink('AddItem');
    await expect(otherLink).toHaveCount(0);

    const orderLink = servicesPage.getTopEndpointsTableLink('Order create');
    await expect(orderLink).toBeVisible();
  });
});
