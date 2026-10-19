import { Page } from '@playwright/test';

import { expect, test } from '../utils/base-test';

const STORAGE_KEY = 'hdx-service-map-sampling-factor';

function getStoredSamplingFactor(page: Page) {
  return page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY);
}

async function gotoServiceMap(page: Page, query = '') {
  await page.goto(`/service-map${query}`);
  await expect(page.getByTestId('service-map-sampling-slider')).toBeVisible();
}

test.describe('Service map sampling rate', { tag: ['@service-map'] }, () => {
  test('persists slider selections to local storage', async ({ page }) => {
    await gotoServiceMap(page);
    const label = page.getByTestId('service-map-sampling-label');
    await expect(label).toHaveText('Sampling 10%');
    expect(await getStoredSamplingFactor(page)).toBeNull();

    await page
      .getByTestId('service-map-sampling-slider')
      .getByRole('slider')
      .press('ArrowRight');

    await expect(label).toHaveText('Sampling 50%');
    await expect(page).toHaveURL(/samplingFactor=2/);
    expect(await getStoredSamplingFactor(page)).toBe('2');

    await gotoServiceMap(page);
    await expect(label).toHaveText('Sampling 50%');
  });

  test('prefers the URL param without overwriting local storage', async ({
    page,
  }) => {
    await gotoServiceMap(page);
    await page.evaluate(
      key => window.localStorage.setItem(key, JSON.stringify(2)),
      STORAGE_KEY,
    );

    await gotoServiceMap(page, '?samplingFactor=100');
    const label = page.getByTestId('service-map-sampling-label');
    await expect(label).toHaveText('Sampling 1%');
    expect(await getStoredSamplingFactor(page)).toBe('2');

    await gotoServiceMap(page);
    await expect(label).toHaveText('Sampling 50%');
  });
});
