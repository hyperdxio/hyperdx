import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.NETFLOW_APP_URL || 'http://127.0.0.1:3000';
const artifacts = new URL('../packages/app/test-results/netflow/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [query, unit] of [['?srcAddr=192.0.2.2', 'Mbit/s'], ['', 'Gbit/s']]) {
      await page.goto(`${baseUrl}/netflow${query}`);
      await expect(page.getByRole('button', { name: 'Inspect flow 1', exact: true })).toBeVisible({ timeout: 60000 });
      if (width === 1280 && unit === 'Mbit/s') {
        const devtools = page.getByRole('button', { name: 'Close tanstack query devtools', exact: true });
        const opened = await devtools.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
        if (opened) {
          await devtools.click();
          await expect(devtools).toBeHidden();
        }
      }
      await page.getByText('Network traffic', { exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' }));
      await page.evaluate(() => document.fonts.ready);
      const labels = page.locator('text.recharts-cartesian-axis-tick-value').filter({ hasText: unit });
      await expect(labels.first()).toBeVisible();
      await expect.poll(async () => labels.evaluateAll(nodes => nodes.every(node => {
        const bounds = node.getBoundingClientRect();
        const viewport = node.ownerSVGElement?.getBoundingClientRect();
        return node.querySelectorAll('tspan').length === 1 && viewport &&
          bounds.left >= viewport.left && bounds.right <= viewport.right;
      }))).toBe(true);
      await page.screenshot({ path: new URL(`axis-${unit.startsWith('M') ? 'mbit' : 'gbit'}-${width}.png`, artifacts).pathname });
    }
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('NetFlow axis checks passed: Mbit/s and Gbit/s labels fit on one line at 1280px and 800px.');
} finally {
  await browser.close();
}
