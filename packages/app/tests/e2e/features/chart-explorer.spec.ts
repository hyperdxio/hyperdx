import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME, E2E_LOGS_TABLE } from '../utils/constants';

test.describe('Chart Explorer Functionality', { tag: ['@charts'] }, () => {
  let chartExplorerPage: ChartExplorerPage;

  test.beforeEach(async ({ page }) => {
    chartExplorerPage = new ChartExplorerPage(page);
    await chartExplorerPage.goto();
  });

  test('should interact with chart configuration', async () => {
    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
    });

    await test.step('Can run basic query and display chart', async () => {
      // Use chart editor component to run query
      await expect(chartExplorerPage.chartEditor.runButton).toBeVisible();
      // wait for network idle
      await chartExplorerPage.page.waitForLoadState('networkidle');

      await chartExplorerPage.chartEditor.runQuery();

      // Verify chart is rendered
      const chartContainer = chartExplorerPage.getFirstChart();
      await expect(chartContainer).toBeVisible();
    });
  });

  test('should render a bar chart', async () => {
    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
    });

    await test.step('Select the Bar chart type', async () => {
      await chartExplorerPage.page.waitForLoadState('networkidle');
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Bar);
    });

    await test.step('Run query and verify the bar chart renders', async () => {
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
      await chartExplorerPage.chartEditor.runQuery();

      await expect(
        chartExplorerPage.page.locator(
          '[data-testid="bar-chart-container"] .recharts-responsive-container',
        ),
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test('should limit the number of bars on a categorical bar chart', async () => {
    let totalBars = 0;

    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
      await chartExplorerPage.page.waitForLoadState('networkidle');
    });

    await test.step('Select the Bar chart type', async () => {
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Bar);
    });

    await test.step('Set group by ServiceName and run the query', async () => {
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
      await chartExplorerPage.chartEditor.runQuery();

      await expect(chartExplorerPage.getBars().first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step('Verify the unrestricted chart renders more bars than the limit we will apply', async () => {
      totalBars = await chartExplorerPage.getBars().count();
      expect(totalBars).toBeGreaterThan(3);
    });

    await test.step('Apply a series limit of 3', async () => {
      await chartExplorerPage.chartEditor.setSeriesLimit(3);
      // Re-run to ensure the limited config is fetched and rendered even if
      // the Display Settings drawer's own auto-submit hasn't settled yet.
      await chartExplorerPage.chartEditor.runQuery();
    });

    await test.step('Verify the chart now renders exactly the limited number of bars', async () => {
      const seriesLimit = 3;
      await expect
        .poll(async () => chartExplorerPage.getBars().count(), {
          timeout: 10000,
        })
        .toBe(seriesLimit);

      // Sanity check: the limit actually reduced the number of bars shown.
      expect(seriesLimit).toBeLessThan(totalBars);
    });
  });

  test('should apply a custom ORDER BY on a categorical bar chart', async () => {
    let ascendingLabels: string[] = [];
    let descendingLabels: string[] = [];

    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
      await chartExplorerPage.page.waitForLoadState('networkidle');
    });

    await test.step('Select the Bar chart type and group by ServiceName', async () => {
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Bar);
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
    });

    await test.step('Order by ServiceName ascending and capture the bar order', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName ASC');
      await chartExplorerPage.chartEditor.runQuery();
      await expect(chartExplorerPage.getBars().first()).toBeVisible({
        timeout: 15000,
      });

      ascendingLabels = await chartExplorerPage.getBarLabels();
      // Need at least two distinct bars for the ordering to be observable.
      expect(ascendingLabels.length).toBeGreaterThan(1);
    });

    await test.step('Order by ServiceName descending and verify the order is reversed', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName DESC');
      await chartExplorerPage.chartEditor.runQuery();

      // The descending result must be the exact reverse of the ascending one,
      // proving the custom ORDER BY is driving the SQL query ordering.
      await expect
        .poll(async () => chartExplorerPage.getBarLabels(), { timeout: 10000 })
        .toEqual([...ascendingLabels].reverse());

      descendingLabels = await chartExplorerPage.getBarLabels();
    });

    await test.step('Apply a series limit and confirm the custom order still drives which bars are kept', async () => {
      const seriesLimit = 3;
      await chartExplorerPage.chartEditor.setSeriesLimit(seriesLimit);
      await chartExplorerPage.chartEditor.runQuery();

      await expect
        .poll(async () => chartExplorerPage.getBars().count(), {
          timeout: 10000,
        })
        .toBe(seriesLimit);

      // With ServiceName DESC + LIMIT 3, the kept bars must be the first three
      // of the descending order — not the three largest by value. This proves
      // the custom ORDER BY overrides the default value-descending ordering and
      // is honored alongside the series limit.
      await expect
        .poll(async () => chartExplorerPage.getBarLabels(), { timeout: 10000 })
        .toEqual(descendingLabels.slice(0, seriesLimit));
    });
  });

  test('should apply a custom ORDER BY on a categorical pie chart', async () => {
    let ascendingLabels: string[] = [];
    let descendingLabels: string[] = [];

    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
      await chartExplorerPage.page.waitForLoadState('networkidle');
    });

    await test.step('Select the Pie chart type and group by ServiceName', async () => {
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Pie);
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
    });

    await test.step('Order by ServiceName ascending and capture the legend order', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName ASC');
      await chartExplorerPage.chartEditor.runQuery();

      // Recharts populates the pie legend progressively as the chart animates
      // in, so a single read can catch it with only one row. Poll until at
      // least two slices are present (the ordering needs >1 to be observable)
      // before capturing, mirroring the descending step below.
      await expect
        .poll(
          async () => (await chartExplorerPage.getPieLegendLabels()).length,
          {
            timeout: 15000,
          },
        )
        .toBeGreaterThan(1);

      ascendingLabels = await chartExplorerPage.getPieLegendLabels();
    });

    await test.step('Order by ServiceName descending and verify the order is reversed', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName DESC');
      await chartExplorerPage.chartEditor.runQuery();

      // The descending result must be the exact reverse of the ascending one,
      // proving the custom ORDER BY is driving the SQL query ordering.
      await expect
        .poll(async () => chartExplorerPage.getPieLegendLabels(), {
          timeout: 10000,
        })
        .toEqual([...ascendingLabels].reverse());

      descendingLabels = await chartExplorerPage.getPieLegendLabels();
    });

    await test.step('Apply a series limit and confirm the custom order still drives which slices are kept', async () => {
      const seriesLimit = 3;
      await chartExplorerPage.chartEditor.setSeriesLimit(seriesLimit);
      await chartExplorerPage.chartEditor.runQuery();

      // With ServiceName DESC + LIMIT 3, the kept slices must be the first
      // three of the descending order — not the three largest by value. This
      // proves the custom ORDER BY overrides the default value-descending
      // ordering and is honored alongside the series limit.
      await expect
        .poll(async () => chartExplorerPage.getPieLegendLabels(), {
          timeout: 10000,
        })
        .toEqual(descendingLabels.slice(0, seriesLimit));
    });
  });
  test(
    'should carry the builder config over to a macro-based SQL template when switching to SQL mode',
    { tag: '@full-stack' },
    async () => {
      // (beforeEach already navigated to /chart.) Wait for the editor to load.
      await test.step('Wait for the chart editor data to load', async () => {
        await chartExplorerPage.chartEditor.waitForDataToLoad();
      });

      // Select the source, keeping the default Line display type + count() series.
      await test.step('Select the E2E Logs source', async () => {
        await chartExplorerPage.chartEditor.selectSource(
          DEFAULT_LOGS_SOURCE_NAME,
        );
      });

      await test.step('Switch to SQL mode', async () => {
        await chartExplorerPage.chartEditor.switchToSqlMode();
      });

      await test.step('Verify the SQL editor is populated with a macro-based template derived from the builder config', async () => {
        const sqlEditor = chartExplorerPage.chartEditor.sqlEditorContent();
        await expect(sqlEditor).toContainText('$__sourceTable');
        await expect(sqlEditor).toContainText('$__fromTime_ms');
        await expect(sqlEditor).toContainText('$__toTime_ms');
        await expect(sqlEditor).toContainText('$__timeInterval(');
        await expect(sqlEditor).toContainText('$__filters');
        await expect(sqlEditor).toContainText('count()');
        // Macros, not hardcoded values
        await expect(sqlEditor).not.toContainText(E2E_LOGS_TABLE);
        await expect(sqlEditor).not.toContainText('INTERVAL 1');
      });

      await test.step('Run the generated SQL and verify a chart renders', async () => {
        await chartExplorerPage.chartEditor.runQuery();
        await expect(chartExplorerPage.getFirstChart()).toBeVisible();
      });
    },
  );

  test(
    'should not overwrite hand-edited SQL when toggling back to SQL mode',
    { tag: '@full-stack' },
    async () => {
      const handEditedSql = 'SELECT 1 AS hand_edited_marker';

      await test.step('Wait for the chart editor data to load', async () => {
        await chartExplorerPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Select the E2E Logs source', async () => {
        await chartExplorerPage.chartEditor.selectSource(
          DEFAULT_LOGS_SOURCE_NAME,
        );
      });

      await test.step('Switch to SQL mode and wait for the auto-generated template', async () => {
        await chartExplorerPage.chartEditor.switchToSqlMode();
        await expect(
          chartExplorerPage.chartEditor.sqlEditorContent(),
        ).toContainText('$__sourceTable');
      });

      await test.step('Replace the SQL with a hand-written sentinel query', async () => {
        await chartExplorerPage.chartEditor.replaceSqlQuery(handEditedSql);
        await expect(
          chartExplorerPage.chartEditor.sqlEditorContent(),
        ).toContainText('hand_edited_marker');
      });

      await test.step('Switch back to Builder mode, then back to SQL mode', async () => {
        await chartExplorerPage.chartEditor.switchToBuilderMode();
        // Settle on a builder-only control (the series aggregation select)
        // to confirm the mode switch registered before toggling back.
        await expect(chartExplorerPage.chartEditor.aggFn).toBeVisible();
        await chartExplorerPage.chartEditor.switchToSqlMode();
      });

      await test.step('Verify the hand-edited SQL was not overwritten by regeneration', async () => {
        const sqlEditor = chartExplorerPage.chartEditor.sqlEditorContent();
        await expect(sqlEditor).toContainText('hand_edited_marker');
        await expect(sqlEditor).not.toContainText('$__sourceTable');
      });
    },
  );

  test(
    'should regenerate SQL when the builder is edited more recently than the SQL',
    { tag: '@full-stack' },
    async () => {
      const handEditedSql = 'SELECT 1 AS hand_edited_marker';

      await test.step('Wait for the chart editor data to load', async () => {
        await chartExplorerPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Select the E2E Logs source', async () => {
        await chartExplorerPage.chartEditor.selectSource(
          DEFAULT_LOGS_SOURCE_NAME,
        );
      });

      await test.step('Switch to SQL mode and wait for the auto-generated template', async () => {
        await chartExplorerPage.chartEditor.switchToSqlMode();
        await expect(
          chartExplorerPage.chartEditor.sqlEditorContent(),
        ).toContainText('$__sourceTable');
      });

      await test.step('Replace the SQL with a hand-written sentinel query', async () => {
        await chartExplorerPage.chartEditor.replaceSqlQuery(handEditedSql);
        await expect(
          chartExplorerPage.chartEditor.sqlEditorContent(),
        ).toContainText('hand_edited_marker');
      });

      await test.step('Switch to Builder mode and make a builder edit (group by)', async () => {
        await chartExplorerPage.chartEditor.switchToBuilderMode();
        await expect(chartExplorerPage.chartEditor.aggFn).toBeVisible();
        // A genuine builder edit — this is now the most recent edit, so the
        // next switch to SQL should regenerate and discard the hand-edited SQL.
        await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
      });

      await test.step('Switch back to SQL mode', async () => {
        await chartExplorerPage.chartEditor.switchToSqlMode();
      });

      await test.step('Verify the SQL was regenerated from the newer builder config', async () => {
        const sqlEditor = chartExplorerPage.chartEditor.sqlEditorContent();
        await expect(sqlEditor).toContainText('$__sourceTable');
        await expect(sqlEditor).not.toContainText('hand_edited_marker');
      });
    },
  );
});
