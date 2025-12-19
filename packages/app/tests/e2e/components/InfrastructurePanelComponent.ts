/**
 * InfrastructurePanelComponent - Reusable component for infrastructure metrics
 * Used in side panels to display K8s pod/node metrics
 */
import { Locator, Page } from '@playwright/test';

export class InfrastructurePanelComponent {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Get infrastructure subpanel by resource type
   * @param resourceType - e.g., 'k8s.pod.' or 'k8s.node.'
   */
  getSubpanel(resourceType: string) {
    return this.page.getByTestId(`infra-subpanel-${resourceType}`);
  }

  /**
   * Get metric card within a subpanel
   * @param subpanel - The subpanel locator
   * @param metricType - e.g., 'cpu-usage', 'memory-usage', 'disk-usage'
   */
  getMetricCard(subpanel: Locator, metricType: string) {
    return subpanel.getByTestId(`${metricType}-card`);
  }

  /**
   * Get chart data container within a metric card
   */
  getChartContainer(metricCard: Locator) {
    return metricCard.locator('.recharts-responsive-container');
  }

  /**
   * Get all metric types for a subpanel
   * @param subpanel - The subpanel locator
   */
  async getAllMetrics(subpanel: Locator) {
    const metrics = ['cpu-usage', 'memory-usage', 'disk-usage'];
    const results: Record<string, Locator> = {};

    for (const metric of metrics) {
      results[metric] = this.getChartContainer(
        this.getMetricCard(subpanel, metric),
      );
    }

    return results;
  }

  /**
   * Verify all standard metrics are visible for a resource
   * @param resourceType - e.g., 'k8s.pod.' or 'k8s.node.'
   */
  async verifyStandardMetrics(resourceType: string) {
    const subpanel = this.getSubpanel(resourceType);
    const metrics = await this.getAllMetrics(subpanel);

    return {
      subpanel,
      cpuUsage: metrics['cpu-usage'],
      memoryUsage: metrics['memory-usage'],
      diskUsage: metrics['disk-usage'],
    };
  }
}
