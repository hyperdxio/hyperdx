import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.NETFLOW_APP_URL || 'http://127.0.0.1:3000';
const artifacts = new URL(
  '../packages/app/test-results/netflow/',
  import.meta.url,
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  for (const [from, to] of [[1791565200000, 1791565200000], [1791565200000, 1791561600000]]) {
    await page.goto(`${baseUrl}/netflow?from=${from}&to=${to}`);
    await expect(page.getByText('Invalid time range', { exact: true })).toBeVisible();
    await expect(page.getByTestId('netflow-records')).toHaveCount(0);
    await page.getByRole('button', { name: 'Use past hour', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Inspect flow 1', exact: true })).toBeVisible({ timeout: 60000 });
  }
  await page.goto(`${baseUrl}/netflow`, { waitUntil: 'domcontentloaded' });
  const records = page.getByTestId('netflow-records');
  const firstFlow = () => records.locator('tbody tr').first();
  const pills = page.getByTestId('netflow-filter-pills');
  const addProtocolFilter = async () => {
    await firstFlow().getByRole('button', { name: /^Filter protocol:/ }).click();
    await page.getByRole('menuitem', { name: 'Include', exact: true }).click();
    await expect(pills.getByRole('button', { name: 'Remove filter' })).toHaveCount(1);
  };
  await expect(
    page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const devtools = page.getByRole('button', {
    name: 'Close tanstack query devtools',
    exact: true,
  });
  await devtools.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await devtools.isVisible()) {
    await devtools.click();
    await expect(devtools).toBeHidden();
  }
  await expect(
    page.getByText(
      'Error loading chart, please check your query or try again later.',
    ),
  ).toHaveCount(0);
  await expect(records.locator('tbody tr')).toHaveCount(500);
  await page.screenshot({ path: new URL('overview.png', artifacts).pathname });

  const search = page.getByTestId('netflow-search');
  await search.click();
  await expect(
    page.getByTestId('autocomplete-suggestion').first(),
  ).toBeVisible();
  await search.fill('Src');
  const sourceColumn = page
    .getByTestId('autocomplete-suggestion')
    .filter({ hasText: 'SrcAddr (string)' });
  await expect(sourceColumn).toBeVisible();
  await sourceColumn.click();
  await expect(search).toHaveValue('SrcAddr');
  await search.fill('DstPo');
  await expect(
    page
      .getByTestId('autocomplete-suggestion')
      .filter({ hasText: 'DstPort (number)' }),
  ).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Tab');
  await expect(search).toHaveValue('DstPort');
  await search.fill('Proto:');
  const protocolValue = page
    .getByTestId('autocomplete-suggestion')
    .filter({ hasText: 'Proto:"6"' });
  await expect(protocolValue).toBeVisible();
  await protocolValue.click();
  await expect(search).toHaveValue('Proto:"6"');
  const lucene = 'Proto:6 AND DstPort:443';
  await expect(
    page.getByRole('combobox', { name: 'Query language', exact: true }),
  ).toHaveValue('Lucene');
  await search.fill(lucene);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('where'))
    .toBe(lucene);
  await expect(firstFlow().locator('td').nth(3)).toHaveText('TCP');
  await expect(firstFlow().locator('td').nth(2)).toContainText('443');
  await expect(records.getByText('UDP', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(search).toHaveValue(lucene);
  await expect(firstFlow().locator('td').nth(2)).toContainText('443');
  await page.getByLabel('Protocol', { exact: true }).fill('17');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(records.getByText('No flow records found')).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(search).toHaveValue('');
  await expect(records.locator('tbody tr')).toHaveCount(500);
  await search.fill('Proto:17');
  await search.press('Escape');
  await search.press('Enter');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('where'))
    .toBe('Proto:17');
  await expect(firstFlow().locator('td').nth(3)).toHaveText('UDP');
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(search).toHaveValue('');

  await page.getByLabel('Protocol', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page).toHaveURL(/protocol=6/);
  await expect(firstFlow().locator('td').nth(3)).toHaveText('TCP');
  await expect(records.getByText('UDP', { exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page).not.toHaveURL(/(?:protocol|srcAddr|exporter)=[^&]+/);
  await page.getByLabel('Source IP', { exact: true }).fill('192.0.2.2');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page).toHaveURL(/srcAddr=192.0.2.2/);
  await expect(firstFlow().locator('td').nth(1)).toContainText('192.0.2.2');

  await page
    .getByRole('button', { name: 'Inspect flow 1', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Flow details' });
  await expect(drawer).toBeVisible();
  const field = async label =>
    Number(
      await drawer
        .getByRole('row')
        .filter({
          has: page.getByRole('rowheader', { name: label, exact: true }),
        })
        .getByRole('cell')
        .innerText(),
    );
  assert.equal(
    await field('Bytes'),
    (await field('Raw bytes')) * (await field('Sampling rate')),
  );
  assert.equal(
    await field('Packets'),
    (await field('Raw packets')) * (await field('Sampling rate')),
  );
  await page.screenshot({
    path: new URL('flow-details.png', artifacts).pathname,
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page).not.toHaveURL(/(?:protocol|srcAddr|exporter)=[^&]+/);
  await page.getByLabel('Exporter', { exact: true }).fill("missing' OR 1=1 --");
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(records.getByText('No flow records found')).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page).not.toHaveURL(/(?:protocol|srcAddr|exporter)=[^&]+/);
  await expect(
    page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh NetFlow', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Refresh NetFlow', exact: true }),
  ).toBeEnabled();

  await page
    .getByRole('button', { name: 'Source actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Edit source', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Edit NetFlow source' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('dialog')
      .getByText('Sampling multiplier (optional)', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await addProtocolFilter();
  await page
    .getByRole('button', { name: 'Source actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Create new source', exact: true })
    .click();
  const sourceForm = page.getByRole('dialog', { name: 'Add NetFlow source' });
  await sourceForm.locator('input[name=name]').fill('NetFlow browser test');
  await sourceForm
    .getByPlaceholder('Database', { exact: true })
    .fill('netflow_demo');
  await page.getByRole('option', { name: 'netflow_demo', exact: true }).click();
  await sourceForm.getByPlaceholder('Table', { exact: true }).fill('flows');
  await page.getByRole('option', { name: 'flows', exact: true }).click();
  await expect(sourceForm.locator('.cm-content').first()).toHaveText(
    'TimeReceived',
  );
  await sourceForm
    .getByRole('button', { name: 'Save New Source', exact: true })
    .click();
  await expect(sourceForm).toBeHidden();
  await expect(pills.getByRole('button', { name: 'Remove filter' })).toHaveCount(0);
  await addProtocolFilter();
  const namedSourceUrl = new URL(page.url());
  namedSourceUrl.searchParams.set('source', 'NetFlow browser test');
  await page.goto(namedSourceUrl.href);
  await expect(pills.getByRole('button', { name: 'Remove filter' })).toHaveCount(1);
  // Source changes apply before Run, including the edit target and URL.
  await page.getByRole('combobox', { name: 'NetFlow source', exact: true }).click();
  await page.getByRole('option', { name: 'NetFlow demo', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('source')).toBe('netflow-demo');
  await expect(pills.getByRole('button', { name: 'Remove filter' })).toHaveCount(0);
  await expect.poll(() => JSON.parse(decodeURIComponent(new URL(page.url()).searchParams.get('filters') || '[]'))).toEqual([]);
  await page.getByRole('button', { name: 'Source actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit source', exact: true }).click();
  await expect(page.getByRole('dialog').locator('input[name=name]')).toHaveValue('NetFlow demo');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(
    page
      .getByRole('cell')
      .filter({ hasText: /192\.0\.2/ })
      .first(),
  ).toBeVisible({ timeout: 30000 });

  await page.goto(`${baseUrl}/netflow?source=missing-source`);
  await expect(page.getByText('NetFlow source unavailable')).toBeVisible();
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(
    'NetFlow browser checks passed: data, filters, sampling, details, refresh, source creation/reload/switching, Search, unavailable source, invalid time range recovery.',
  );
  console.log(`Screenshots: ${artifacts.pathname}`);
} finally {
  await browser.close();
}
