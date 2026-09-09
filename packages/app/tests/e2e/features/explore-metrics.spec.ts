/**
 * Grouped time-series tests for the Explore page with a metric source.
 *
 * Seed: "E2E Metrics" gauge table with k8s pod/namespace metrics, grouped by
 * namespace → produces ≥ 2 series. Correlations: E2E Metrics → E2E Logs →
 * E2E Traces (via logSourceId / traceSourceId in the fixture).
 */
import { ExplorePage } from '../page-objects/ExplorePage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_METRICS_SOURCE_NAME } from '../utils/constants';

const METRIC_NAME = 'k8s.pod.phase';
// Value format mirrors MetricNameSelect's internal SEPARATOR (7 colons + type).
const METRIC_VALUE = 'k8s.pod.phase:::::::gauge';
const GROUP_BY_FIELD = "ResourceAttributes['k8s.namespace.name']";

test.describe(
  'Explore metrics grouped time-series',
  { tag: ['@full-stack', '@explore'] },
  () => {
    let explorePage: ExplorePage;

    test.beforeEach(async ({ page }) => {
      explorePage = new ExplorePage(page);
      // Navigate via UI, not URL params: in full-stack mode the source URL
      // param expects a MongoDB ObjectId, not the human-readable name.
      await explorePage.goto();
      await explorePage.selectSource(DEFAULT_METRICS_SOURCE_NAME);
      await explorePage.selectMetric(METRIC_NAME, METRIC_VALUE);
      await explorePage.setGroupBy(GROUP_BY_FIELD);
      await explorePage.runQuery();
    });

    test('renders a grouped time-series chart with at least two series', async () => {
      await expect(explorePage.getChartContainer()).toBeVisible();
      await expect
        .poll(() => explorePage.countChartSeries(), { timeout: 10000 })
        .toBeGreaterThanOrEqual(2);
    });

    test('chart settings drawer exposes the alignment control and accepts a change', async () => {
      await explorePage.openChartSettings();
      await expect(explorePage.getChartSettingsDrawer()).toBeVisible({
        timeout: 5000,
      });
      await expect(explorePage.getAlignmentControl()).toBeVisible();
      await explorePage.selectGranularity('1 hour');
      await explorePage.applyChartSettings();
      await expect(explorePage.getChartSettingsDrawer()).toBeHidden({
        timeout: 5000,
      });
    });

    test('pinned tooltip shows correlation links and a series filter action', async () => {
      await explorePage.clickChartToPin();
      await expect(explorePage.getPinnedTooltip()).toBeVisible({
        timeout: 5000,
      });

      await expect(explorePage.getFirstSeriesActionsButton()).toBeVisible({
        timeout: 5000,
      });
      await expect
        .poll(() => explorePage.countSeriesActionButtons(), { timeout: 5000 })
        .toBeGreaterThanOrEqual(2);

      const dataKey = await explorePage.openFirstSeriesActionsMenu();
      expect(dataKey).toBeTruthy();

      await expect(explorePage.getViewRelatedLogsLink(dataKey)).toBeVisible({
        timeout: 3000,
      });
      const logsUrl = await explorePage.getRelatedLogsUrl(dataKey);
      expect(logsUrl?.pathname).toBe('/explore');
      // source is a MongoDB ObjectId in full-stack mode, not the source name
      expect(logsUrl?.searchParams.get('source')).toBeTruthy();

      await expect(explorePage.getViewRelatedTracesLink(dataKey)).toBeVisible({
        timeout: 3000,
      });
      const tracesUrl = await explorePage.getRelatedTracesUrl(dataKey);
      expect(tracesUrl?.pathname).toBe('/explore');
      expect(tracesUrl?.searchParams.get('source')).toBeTruthy();

      await explorePage.filterToSeries(dataKey);
      await expect(explorePage.getFirstActiveFilterPill()).toBeVisible({
        timeout: 8000,
      });
    });
  },
);
