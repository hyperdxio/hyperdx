// tests/alerts/alerts.spec.ts
import { expect, Page, test } from '@playwright/test';

import login from '../utils/loginHelper';

test('Test alerts list page navigation', async ({ page }: { page: Page }) => {
  await login(page);

  // Navigate to alerts page
  await page.goto('http://localhost:8080/alerts');

  // Wait for alerts list to load
  const alertsList = page.locator('[data-testid="alerts-list"]');
  await expect(alertsList).toBeVisible();

  // Check if create alert button exists
  const createAlertBtn = page.locator('[data-testid="create-alert-button"]');
  await expect(createAlertBtn).toBeVisible();
});

test('Test alert creation form', async ({ page }: { page: Page }) => {
  await login(page);

  // Navigate to alerts page
  await page.goto('http://localhost:8080/alerts');

  // Click create alert button
  const createAlertBtn = page.locator('[data-testid="create-alert-button"]');
  await createAlertBtn.click();

  // Verify alert creation form appears
  const alertForm = page.locator('[data-testid="alert-form"]');
  await expect(alertForm).toBeVisible();

  // Check for alert name field
  const alertNameField = page.locator('[data-testid="alert-name-field"]');
  await expect(alertNameField).toBeVisible();

  // Test alert type selection
  const alertTypeSelect = page.locator('[data-testid="alert-type-select"]');
  await expect(alertTypeSelect).toBeVisible();

  // Try selecting an alert type (e.g., "Log Alert")
  await alertTypeSelect.click();
  const logAlertOption = page.locator('text=Log Alert');
  await logAlertOption.click();

  // Check for query builder
  const queryBuilder = page.locator('[data-testid="query-builder"]');
  await expect(queryBuilder).toBeVisible();

  // Cancel alert creation
  const cancelButton = page.locator('[data-testid="cancel-button"]');
  await cancelButton.click();

  // Verify we're back to the alerts list
  const alertsList = page.locator('[data-testid="alerts-list"]');
  await expect(alertsList).toBeVisible();
});
