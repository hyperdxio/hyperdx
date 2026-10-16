import { expect, test } from '../../fixtures/netflow';

test.use({ viewport: { width: 1600, height: 1050 } });

test('NetFlow Sankey dimensions, filters, empty classifications and URL state', async ({
  page,
  netflow,
}) => {
  await page.goto(`/netflow?source=${netflow.source.id}`);
  await page.getByText('Sankey', { exact: true }).click();
  const graph = page.getByTestId('netflow-sankey-graph');
  const table = page.getByTestId('netflow-sankey-table');
  const rows = table.locator('tbody tr');
  await expect(graph.locator('svg')).toBeVisible();
  await expect(rows).toHaveCount(4);
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
  await provider.click();
  await page.getByRole('menuitem', { name: 'Include', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').nth(2)).toHaveText('peer-east');
  await page.reload();
  await expect(rows).toHaveCount(1);
  await provider.click();
  await page.getByRole('menuitem', { name: 'Exclude', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(provider).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(rows).toHaveCount(4);
  await graph
    .getByRole('button', { name: 'Filter InIfProvider: (empty)', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Include', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Clear Sankey dimensions', exact: true })
    .click();
  await expect(
    page.getByText('Choose two to five dimensions', { exact: true }),
  ).toBeVisible();
  const picker = page.locator('input[aria-label="Sankey dimensions"]');
  for (const name of ['Source IP', 'Protocol', 'Destination IP']) {
    await picker.fill(name);
    await page.getByRole('option', { name, exact: true }).click();
  }
  await picker.press('Escape');
  await page
    .getByRole('combobox', { name: 'Sankey path limit', exact: true })
    .click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await page.reload();
  await expect(table.getByRole('columnheader').first()).toHaveText('Source IP');
  await expect(
    page.getByRole('combobox', { name: 'Sankey path limit', exact: true }),
  ).toHaveValue('10');
  await page.setViewportSize({ width: 800, height: 1000 });
  await graph.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByTestId('netflow-search').fill('ExporterName:missing');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(
    page.getByText('No traffic paths found', { exact: true }),
  ).toBeVisible();
  await page.getByText('Time series', { exact: true }).click();
  await expect(page.getByTestId('netflow-sankey')).toHaveCount(0);
});

test('real NetFlow chart axes keep Mbit/s and Gbit/s labels inside the SVG', async ({
  page,
  netflow,
}) => {
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [filter, unit] of [
      ['&srcAddr=192.0.2.2', 'Mbit/s'],
      ['', 'Gbit/s'],
    ]) {
      await page.goto(`/netflow?source=${netflow.source.id}${filter}`);
      await expect(
        page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
      ).toBeVisible();
      await page
        .getByText('Network traffic', { exact: true })
        .scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const labels = page
        .locator('text.recharts-cartesian-axis-tick-value')
        .filter({ hasText: unit });
      await expect(labels.first()).toBeVisible();
      await expect
        .poll(() =>
          labels.evaluateAll(nodes =>
            nodes.every(node => {
              const bounds = node.getBoundingClientRect();
              const viewport = node.closest('svg')?.getBoundingClientRect();
              return (
                node.querySelectorAll('tspan').length === 1 &&
                viewport &&
                bounds.left >= viewport.left &&
                bounds.right <= viewport.right
              );
            }),
          ),
        )
        .toBe(true);
    }
  }
});
