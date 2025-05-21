import { expect, Page } from '@playwright/test';

export type AlertOptions = {
  name: string;
  type: 'log' | 'metric';
  query?: string;
  threshold?: number;
  operation?: 'above' | 'below' | 'equals';
  duration?: string;
  channel?: string;
  groupBy?: string;
  severity?: 'critical' | 'warning' | 'info';
};

/**
 * Navigate to alerts page
 */
export async function navigateToAlerts(page: Page) {
  await page.goto('http://localhost:8080/alerts');
  await expect(page.locator('h1:has-text("Alerts")')).toBeVisible();
}

/**
 * Create a new alert with the specified options
 */
export async function createAlert(page: Page, options: AlertOptions) {
  await navigateToAlerts(page);

  // Click create alert button
  const createAlertBtn = page.locator('[data-testid="create-alert-button"]');
  await expect(createAlertBtn).toBeVisible();
  await createAlertBtn.click();

  // Fill alert name
  const alertNameInput = page.locator('[data-testid="alert-name-input"]');
  await expect(alertNameInput).toBeVisible();
  await alertNameInput.fill(options.name);

  // Select alert type
  const alertTypeSelect = page.locator('[data-testid="alert-type-select"]');
  await alertTypeSelect.click();
  await page
    .getByRole('option', {
      name: options.type === 'log' ? 'Log Alert' : 'Metric Alert',
    })
    .click();

  // Fill query if provided
  if (options.query) {
    const queryEditor = page.locator('[data-testid="alert-query-editor"]');
    await expect(queryEditor).toBeVisible();
    await queryEditor.fill(options.query);
  }

  // Set threshold if provided
  if (options.threshold !== undefined) {
    const thresholdInput = page.locator(
      '[data-testid="alert-threshold-input"]',
    );
    await expect(thresholdInput).toBeVisible();
    await thresholdInput.fill(options.threshold.toString());

    // Select operation if provided
    if (options.operation) {
      const operationSelect = page.locator(
        '[data-testid="alert-operation-select"]',
      );
      await operationSelect.click();
      await page.getByRole('option', { name: options.operation }).click();
    }
  }

  // Set duration if provided
  if (options.duration) {
    const durationSelect = page.locator(
      '[data-testid="alert-duration-select"]',
    );
    await durationSelect.click();
    await page.getByRole('option', { name: options.duration }).click();
  }

  // Set group by if provided
  if (options.groupBy) {
    const groupBySelect = page.locator('[data-testid="alert-group-by-select"]');
    await groupBySelect.click();
    await page.getByRole('option', { name: options.groupBy }).click();
  }

  // Set severity if provided
  if (options.severity) {
    const severitySelect = page.locator(
      '[data-testid="alert-severity-select"]',
    );
    await severitySelect.click();
    await page.getByRole('option', { name: options.severity }).click();
  }

  // Select notification channel if provided
  if (options.channel) {
    const channelSelect = page.locator('[data-testid="alert-channel-select"]');
    await channelSelect.click();
    await page.getByRole('option', { name: options.channel }).click();
  }

  // Save the alert
  const saveButton = page.locator('[data-testid="save-alert-button"]');
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  // Wait for redirect back to alerts page
  await expect(page).toHaveURL('http://localhost:8080/alerts');
}

/**
 * Delete an alert by name
 */
export async function deleteAlert(page: Page, alertName: string) {
  await navigateToAlerts(page);

  // Find the alert by name
  const alertRow = page.locator(
    `[data-testid="alert-row"]:has-text("${alertName}")`,
  );
  await expect(alertRow).toBeVisible();

  // Click on the menu for the alert
  const menuButton = alertRow.locator('[data-testid="alert-menu-button"]');
  await menuButton.click();

  // Click delete option
  const deleteOption = page.locator('[data-testid="delete-alert-option"]');
  await expect(deleteOption).toBeVisible();
  await deleteOption.click();

  // Confirm deletion
  const confirmButton = page.locator('[data-testid="confirm-delete-button"]');
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  // Verify the alert is no longer visible
  await expect(alertRow).not.toBeVisible();
}

/**
 * Check if an alert exists by name
 */
export async function alertExists(
  page: Page,
  alertName: string,
): Promise<boolean> {
  await navigateToAlerts(page);

  const alertRow = page.locator(
    `[data-testid="alert-row"]:has-text("${alertName}")`,
  );
  return (await alertRow.count()) > 0;
}

/**
 * Get alert status by name
 */
export async function getAlertStatus(
  page: Page,
  alertName: string,
): Promise<string> {
  await navigateToAlerts(page);

  const alertRow = page.locator(
    `[data-testid="alert-row"]:has-text("${alertName}")`,
  );
  await expect(alertRow).toBeVisible();

  const statusCell = alertRow.locator('[data-testid="alert-status"]');
  return await statusCell.innerText();
}
