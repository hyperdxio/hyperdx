import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.NETFLOW_APP_URL || 'http://127.0.0.1:3001';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const records = page.getByTestId('netflow-records');
const pills = page.getByTestId('netflow-filter-pills');
const clear = async () => {
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(
    pills.getByRole('button', { name: 'Remove filter' }),
  ).toHaveCount(0);
  await expect(records.locator('tbody tr')).toHaveCount(500);
};
const choose = async (target, action) => {
  await target.click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};
try {
  await page.goto(`${baseUrl}/netflow`);
  await expect(records.locator('tbody tr')).toHaveCount(500, {
    timeout: 60000,
  });
  const devtools = page.getByRole('button', {
    name: 'Close tanstack query devtools',
    exact: true,
  });
  if (await devtools.isVisible()) await devtools.click();
  for (const field of ['srcAddr', 'dstAddr', 'protocol', 'exporter']) {
    console.log(`Checking ${field} chart filters`);
    const chart = page.getByTestId(`netflow-breakdown-${field}`);
    const first = chart
      .getByRole('button', { name: new RegExp(`^Filter ${field}:`) })
      .first();
    const value = await first.innerText();
    const matchingRows = records.getByRole('button', {
      name: `Filter ${field}: ${value}`,
      exact: true,
    });
    await choose(first, 'Include');
    await expect(pills).toContainText(`= ${value}`);
    await expect
      .poll(async () => {
        const matches = await matchingRows.count();
        return (
          matches > 0 && matches === (await records.locator('tbody tr').count())
        );
      })
      .toBe(true);
    await expect(matchingRows.first()).toBeVisible();
    assert.equal(
      await matchingRows.count(),
      await records.locator('tbody tr').count(),
    );
    await page.reload();
    await expect(pills).toContainText(`= ${value}`);
    await expect(matchingRows.first()).toBeVisible();
    await pills.getByRole('button', { name: 'Remove filter' }).click();
    await expect(records.locator('tbody tr')).toHaveCount(500);
    await choose(
      chart.getByRole('button', {
        name: `Filter ${field}: ${value}`,
        exact: true,
      }),
      'Exclude',
    );
    await expect(pills).toContainText(`!= ${value}`);
    await expect(matchingRows).toHaveCount(0);
    await expect(records.locator('tbody tr')).toHaveCount(500);
    await clear();
  }
  // Row actions preserve the Lucene query and apply immediately without Run.
  const search = page.getByTestId('netflow-search');
  await search.fill('DstPort:443 OR DstPort:80');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await choose(
    records
      .getByRole('button', { name: 'Filter protocol: TCP', exact: true })
      .first(),
    'Include',
  );
  await expect(search).toHaveValue('DstPort:443 OR DstPort:80');
  await expect(pills).toContainText('Protocol = TCP');
  await expect(
    records.getByRole('button', { name: 'Filter protocol: UDP', exact: true }),
  ).toHaveCount(0);
  await clear();
  // Native IPv6 address and drawer actions.
  const ipv6 = records
    .getByRole('button', { name: /^Filter srcAddr: 2001:/ })
    .first();
  const ipv6Value = await ipv6.innerText();
  await choose(ipv6, 'Include');
  await expect(pills).toContainText(ipv6Value);
  await expect(
    records
      .getByRole('button', {
        name: `Filter srcAddr: ${ipv6Value}`,
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Inspect flow 1', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Flow details' });
  await choose(
    drawer.getByRole('button', { name: /^Filter exporter:/ }),
    'Exclude',
  );
  await expect(
    pills.getByRole('button', { name: 'Remove filter' }),
  ).toHaveCount(2);
  await expect(drawer).toBeHidden();
  await clear();
  assert.deepEqual(errors, []);
  console.log(
    'Clickable NetFlow filters passed: chart include/exclude, removal, reload, Lucene composition, row/drawer actions, IPv6, clear.',
  );
} finally {
  await browser.close();
}
