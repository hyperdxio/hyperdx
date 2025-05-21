import { expect, Page, test } from '@playwright/test';

import login from '../utils/loginHelper';

async function createSavedSearch(page: Page, text = 'test-saved-search') {
  await page.locator('[data-testid="search-save-button"]').click();
  await page.locator('[data-testid="search-save-modal"] input').fill(text);
  await page
    .locator('[data-testid="search-save-modal"] button[type="submit"]')
    .click();
  await expect(page.locator('[data-testid="search-save-modal"]')).toBeHidden();
}

async function deleteSavedSearch(page: Page) {
  await page.waitForURL('**/search/*from=*to=*');
  await page.locator('[data-testid="search-page-action-bar-button"]').click();
  await page
    .locator('[data-testid="search-page-action-bar-delete-saved-search"]')
    .click();
}

test('saved search should work', async ({ page }) => {
  await login(page);
  await createSavedSearch(page);
  await expect(page.locator('[data-testid="search-save-modal"]')).toBeHidden();

  // Click on on the saved search link
  const link = await page
    .getByRole('link', { name: 'test-saved-search', exact: true })
    .first();
  await expect(link).toBeVisible();
  await link.click();

  // Check the URL params for search ID
  await page.waitForURL('**/search/*from=*to=*');
  const url = new URL(page.url());
  const searchId = url.pathname.split('/').pop();
  expect(searchId).toBeDefined();
  expect(searchId).toMatch(/^[0-9a-f]+$/); // Verifies it's a hex ID

  // delete saved search
  await deleteSavedSearch(page);
});

test('update saved search should work via update button', async ({ page }) => {
  await login(page);
  await createSavedSearch(page);
  const saveButton = await page.locator('[data-testid="search-save-button"]');
  await expect(saveButton).toHaveText('Update');

  await page.waitForURL('**/search/*from=*to=*');
  await createSavedSearch(page, 'update-saved-search');
  await page.waitForURL('**/search/*from=*to=*');

  const link = await page
    .getByRole('link', { name: 'update-saved-search', exact: true })
    .first();
  await expect(link).toBeVisible();

  await deleteSavedSearch(page);
});

test('update saved search should work via side menu', async ({ page }) => {
  await login(page);
  await createSavedSearch(page);
  await page.waitForURL('**/search/*from=*to=*');

  await page.locator('[data-testid="search-page-action-bar-button"]').click();
  await page
    .locator('[data-testid="search-page-action-bar-rename-saved-search"]')
    .click();

  const modal = await page.locator('[data-testid="search-save-modal"]');
  await expect(modal).toBeInViewport();
  await page
    .locator('[data-testid="search-save-modal"] button[type="submit"]')
    .click();
  await deleteSavedSearch(page);
});
