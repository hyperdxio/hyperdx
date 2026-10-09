import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.NETFLOW_APP_URL || 'http://127.0.0.1:3001';
const artifacts = new URL(
  '../packages/app/test-results/netflow/',
  import.meta.url,
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const graph = page.getByTestId('netflow-sankey-graph');
const table = page.getByTestId('netflow-sankey-table');
const pills = page.getByTestId('netflow-filter-pills');
const rows = () => table.locator('tbody tr');
const choose = async (node, action) => {
  await node.click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};
const closeDevtools = async () => {
  const button = page.getByRole('button', {
    name: 'Close tanstack query devtools',
    exact: true,
  });
  await button.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await button.isVisible()) await button.click();
};
try {
  await page.goto(`${baseUrl}/netflow`);
  await closeDevtools();
  await page.getByText('Sankey', { exact: true }).click();
  await expect(page).toHaveURL(/netflowView=sankey/);
  await expect(graph.locator('svg')).toBeVisible({ timeout: 60000 });
  await expect(rows()).toHaveCount(6);
  await expect(table.getByRole('columnheader')).toHaveText([
    'SrcAS',
    'InIfConnectivity',
    'InIfProvider',
    'Exporter',
    'Average bit rate',
    'Transferred bytes',
  ]);
  const provider = graph.getByRole('button', {
    name: 'Filter InIfProvider: peer-east',
    exact: true,
  });
  await provider.hover();
  await expect(
    page.getByRole('tooltip').filter({ hasText: 'Average bit rate:' }),
  ).toBeVisible();
  await choose(provider, 'Include');
  await expect(pills).toContainText('InIfProvider = peer-east');
  await expect(rows()).toHaveCount(1);
  await expect(rows().first().locator('td').nth(2)).toHaveText('peer-east');
  await page.reload();
  await expect(rows()).toHaveCount(1);
  await expect(pills).toContainText('InIfProvider = peer-east');
  await choose(provider, 'Exclude');
  await expect(pills).toContainText('InIfProvider != peer-east');
  await expect(rows()).toHaveCount(5);
  await expect(
    graph.getByRole('button', {
      name: 'Filter InIfProvider: peer-east',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(rows()).toHaveCount(6);
  // Empty classifications remain filterable, rather than becoming a literal '(empty)' search.
  await choose(
    graph.getByRole('button', {
      name: 'Filter InIfProvider: (empty)',
      exact: true,
    }),
    'Include',
  );
  await expect(rows()).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(rows()).toHaveCount(6);
  // The existing search controls apply to this view too.
  await page.getByTestId('netflow-search').fill('InIfBoundary:external');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(rows()).toHaveCount(3);
  await expect(
    graph.getByRole('button', {
      name: 'Filter InIfProvider: (empty)',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByTestId('netflow-sankey').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: new URL('sankey-desktop.png', artifacts).pathname,
    animations: 'disabled',
  });
  // Use the actual dimension picker to create a different chain.
  const picker = page.locator('input[aria-label="Sankey dimensions"]');
  await page
    .getByRole('button', { name: 'Clear Sankey dimensions', exact: true })
    .click();
  await expect(
    page.getByText('Choose two to five dimensions', { exact: true }),
  ).toBeVisible();
  for (const name of ['Source IP', 'Protocol', 'Destination IP']) {
    await picker.fill(name);
    await page.getByRole('option', { name, exact: true }).click();
  }
  await picker.press('Escape');
  await page
    .getByRole('combobox', { name: 'Sankey path limit', exact: true })
    .click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await expect(rows()).toHaveCount(10);
  await expect(table.getByRole('columnheader')).toHaveText([
    'Source IP',
    'Protocol',
    'Destination IP',
    'Average bit rate',
    'Transferred bytes',
  ]);
  await page.reload();
  await expect(rows()).toHaveCount(10);
  await expect(table.getByRole('columnheader').first()).toHaveText('Source IP');
  await page.setViewportSize({ width: 800, height: 1000 });
  await graph.scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Graph must not overflow the page',
  );
  await page.screenshot({
    path: new URL('sankey-narrow.png', artifacts).pathname,
    animations: 'disabled',
  });
  await page
    .getByTestId('netflow-search')
    .fill('ExporterName:missing-exporter');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(
    page.getByTestId('netflow-sankey').getByText('No traffic paths found'),
  ).toBeVisible();
  await page.getByText('Time series', { exact: true }).click();
  await expect(page.getByTestId('netflow-sankey')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'Sankey browser checks passed: nodes, tooltips, include/exclude, empty values, Lucene, dimension picker, limit, reload, narrow layout, empty state, view switch.',
  );
} finally {
  await browser.close();
}
