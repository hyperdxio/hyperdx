// tests/alerts/alert-creation.spec.ts
import { expect, Page, test } from '@playwright/test';

import { alertExists, createAlert, deleteAlert } from '../utils/alertHelper';
import login from '../utils/loginHelper';

test.describe('Alert Creation Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.afterEach(async ({ page }) => {
    // Clean up any alerts created in tests
    // This ensures tests don't affect each other
    // Note: We don't check results to avoid test failures in cleanup stage
    try {
      await deleteAlert(page, 'Test Log Alert');
      await deleteAlert(page, 'Test Metric Alert');
      await deleteAlert(page, 'Test Alert with Group By');
    } catch (error) {
      // console.log(
      //   'Cleanup error (expected if alert was already deleted):',
      //   error,
      // );
    }
  });

  test('Test creating log alert', async ({ page }) => {
    await createAlert(page, {
      name: 'Test Log Alert',
      type: 'log',
      query: 'level:error',
      threshold: 5,
      operation: 'above',
      duration: '5 minutes',
      severity: 'critical',
    });

    // Verify alert was created
    const exists = await alertExists(page, 'Test Log Alert');
    expect(exists).toBeTruthy();
  });

  test('Test creating metric alert', async ({ page }) => {
    await createAlert(page, {
      name: 'Test Metric Alert',
      type: 'metric',
      query: 'cpu_usage',
      threshold: 90,
      operation: 'above',
      duration: '5 minutes',
      severity: 'warning',
    });

    // Verify alert was created
    const exists = await alertExists(page, 'Test Metric Alert');
    expect(exists).toBeTruthy();
  });

  test('Test creating alert with group by', async ({ page }) => {
    await createAlert(page, {
      name: 'Test Alert with Group By',
      type: 'log',
      query: 'level:error',
      threshold: 5,
      operation: 'above',
      duration: '5 minutes',
      groupBy: 'service',
      severity: 'info',
    });

    // Verify alert was created
    const exists = await alertExists(page, 'Test Alert with Group By');
    expect(exists).toBeTruthy();

    // Navigate to alert detail page
    await page.goto('http://localhost:8080/alerts');
    await page.locator(`text=Test Alert with Group By`).click();

    // Verify group by is displayed
    await expect(page.locator('text=Group By')).toBeVisible();
    await expect(page.locator('text=service')).toBeVisible();
  });

  test('Test alert validation', async ({ page }) => {
    // Navigate to alerts page
    await page.goto('http://localhost:8080/alerts');

    // Click create alert button
    const createAlertBtn = page.locator('[data-testid="create-alert-button"]');
    await createAlertBtn.click();

    // Try to save without required fields
    const saveButton = page.locator('[data-testid="save-alert-button"]');
    await saveButton.click();

    // Verify validation errors
    const validationErrors = page.locator('[data-testid="validation-error"]');
    await expect(validationErrors).toBeVisible();

    // Fill just the name field
    const alertNameInput = page.locator('[data-testid="alert-name-input"]');
    await alertNameInput.fill('Incomplete Alert');

    // Try to save again
    await saveButton.click();

    // Verify still on the creation page (not redirected)
    await expect(page).not.toHaveURL('http://localhost:8080/alerts');
  });

  test('Test cancelling alert creation', async ({ page }) => {
    // Navigate to alerts page
    await page.goto('http://localhost:8080/alerts');

    // Click create alert button
    const createAlertBtn = page.locator('[data-testid="create-alert-button"]');
    await createAlertBtn.click();

    // Fill alert name
    const alertNameInput = page.locator('[data-testid="alert-name-input"]');
    await alertNameInput.fill('Alert To Cancel');

    // Click cancel button
    const cancelButton = page.locator('[data-testid="cancel-button"]');
    await cancelButton.click();

    // Verify redirected back to alerts page
    await expect(page).toHaveURL('http://localhost:8080/alerts');

    // Verify alert was not created
    const exists = await alertExists(page, 'Alert To Cancel');
    expect(exists).toBeFalsy();
  });

  test('Test alert notification channels', async ({ page }) => {
    // Navigate to alerts page
    await page.goto('http://localhost:8080/alerts');

    // Click create alert button
    const createAlertBtn = page.locator('[data-testid="create-alert-button"]');
    await createAlertBtn.click();

    // Fill required fields
    const alertNameInput = page.locator('[data-testid="alert-name-input"]');
    await alertNameInput.fill('Test Alert Notifications');

    // Select alert type
    const alertTypeSelect = page.locator('[data-testid="alert-type-select"]');
    await alertTypeSelect.click();
    await page.getByRole('option', { name: 'Log Alert' }).click();

    // Fill query
    const queryEditor = page.locator('[data-testid="alert-query-editor"]');
    await queryEditor.fill('level:error');

    // Set threshold
    const thresholdInput = page.locator(
      '[data-testid="alert-threshold-input"]',
    );
    await thresholdInput.fill('5');

    // Check notification section
    const notificationSection = page.locator(
      '[data-testid="notification-section"]',
    );
    await expect(notificationSection).toBeVisible();

    // If notification channels exist in the system, check them
    const channelSelect = page.locator('[data-testid="alert-channel-select"]');
    if ((await channelSelect.count()) > 0) {
      await channelSelect.click();

      // Check if there are options available
      const options = page.getByRole('option');
      if ((await options.count()) > 0) {
        await options.first().click();
      }
    }

    // Don't complete the test by saving to avoid actually creating the alert
    // Just verify the notification UI is accessible
  });
});
