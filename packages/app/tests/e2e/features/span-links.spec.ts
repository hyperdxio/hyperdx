import { SearchPage } from '../page-objects/SearchPage';
import { SPAN_LINK_SEED } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

const { producer, consumer } = SPAN_LINK_SEED;

// The seed writes a producer span and, in a different trace, a consumer span
// whose Links reference it. These tests exercise both directions of span-link
// resolution in the span detail panel, plus the breadcrumb pop-back on A <-> B
// hops.
test.describe('Span links', { tag: '@traces' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.timePicker.selectRelativeTime('Last 1 days');
  });

  // Search a span by id, open its row, and select it in the trace waterfall so
  // the span detail panel (Overview) is showing.
  async function openSpanDetail(spanId: string, spanName: string) {
    await searchPage.performSearch(`SpanId:"${spanId}"`);
    await expect(searchPage.table.firstRow).toBeVisible();
    await searchPage.table.clickFirstRow();
    await expect(searchPage.sidePanel.container).toBeVisible();
    await searchPage.sidePanel.clickWaterfallSpan(spanName);
  }

  test('span links resolve the linked span and navigate to its trace', async () => {
    await openSpanDetail(consumer.spanId, consumer.spanName);

    await test.step('link shows the resolved producer details', async () => {
      const linkRow = searchPage.sidePanel.spanLinkRows.first();
      await expect(linkRow).toContainText(producer.spanName);
      await expect(linkRow).toContainText(producer.serviceName);
      // The link's attributes still render alongside the resolved details.
      await expect(linkRow).toContainText('link.kind: follows_from');
    });

    await test.step('clicking the link lands on the producer trace', async () => {
      await searchPage.sidePanel.spanLinkOpenActions.first().click();

      await expect(
        searchPage.sidePanel.getWaterfallSpan(producer.spanName).first(),
      ).toBeVisible();
      // One level deep: root (consumer) + pushed frame (producer).
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toBeVisible();
    });
  });

  test('linked from lists referencing spans and pops back on a return hop', async () => {
    await openSpanDetail(producer.spanId, producer.spanName);

    await test.step('producer shows the consumer under Linked from', async () => {
      const linkedFromRow = searchPage.sidePanel.linkedFromRows.first();
      await expect(linkedFromRow).toContainText(consumer.spanName);
      await expect(linkedFromRow).toContainText(consumer.serviceName);
    });

    await test.step('hop to the consumer pushes a breadcrumb', async () => {
      await searchPage.sidePanel.linkedFromOpenActions.first().click();

      await expect(
        searchPage.sidePanel.getWaterfallSpan(consumer.spanName).first(),
      ).toBeVisible();
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toBeVisible();
    });

    await test.step('following the link back pops instead of pushing', async () => {
      await searchPage.sidePanel.clickWaterfallSpan(consumer.spanName);
      await searchPage.sidePanel.spanLinkOpenActions.first().click();

      await expect(
        searchPage.sidePanel.getWaterfallSpan(producer.spanName).first(),
      ).toBeVisible();
      // Back at the root producer view: the trail did not grow to a third
      // level, it collapsed back to no breadcrumbs at all.
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toBeHidden();
    });
  });
});
