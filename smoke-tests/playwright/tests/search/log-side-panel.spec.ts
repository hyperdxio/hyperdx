// tests/search/log-side-panel.spec.ts
import { expect, Page, test } from '@playwright/test';

import login from '../utils/loginHelper';
import { openLogDetail, performSearch } from '../utils/searchHelper';

test.describe('Log Side Panel Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Navigate to search page and ensure we have results
    await page.goto('http://localhost:8080/search');
    await performSearch(page, '*');

    // Wait for results to load
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);
  });

  test('Test opening log detail panel', async ({ page }) => {
    // Open log detail for the first row
    const sidePanel = await openLogDetail(page);

    // Verify side panel content
    await expect(
      sidePanel.locator('[data-testid="log-detail-content"]'),
    ).toBeVisible();

    // Close panel
    const closeButton = sidePanel.locator('[data-testid="close-panel-button"]');
    await closeButton.click();

    // Verify panel is closed
    await expect(sidePanel).toBeHidden();
  });

  test('Test JSON view in side panel', async ({ page }) => {
    // Open log detail
    const sidePanel = await openLogDetail(page);

    // Switch to JSON view if not already active
    const jsonViewTab = sidePanel.locator('[data-testid="json-view-tab"]');
    await jsonViewTab.click();

    // Verify JSON content is visible
    const jsonContent = sidePanel.locator('[data-testid="json-content"]');
    await expect(jsonContent).toBeVisible();

    // Verify JSON is properly formatted
    const jsonText = await jsonContent.innerText();
    expect(jsonText).toContain('{');
    expect(jsonText).toContain('}');
  });

  test('Test field actions in side panel', async ({ page }) => {
    // Open log detail
    const sidePanel = await openLogDetail(page);

    // Find a field to interact with (e.g., level field)
    const field = sidePanel.locator(
      '[data-testid="field-row"]:has-text("level")',
    );
    await expect(field).toBeVisible();

    // Click field actions menu
    const fieldActionsButton = field.locator(
      '[data-testid="field-actions-button"]',
    );
    await fieldActionsButton.click();

    // Verify actions menu appears
    const actionsMenu = page.locator('[data-testid="field-actions-menu"]');
    await expect(actionsMenu).toBeVisible();

    // Click "Filter by value" action
    const filterAction = actionsMenu.locator('text=Filter by value');
    await filterAction.click();

    // Verify URL updated with filter
    await expect(page.url()).toContain('level');
  });

  test('Test copying field value', async ({ page }) => {
    // Open log detail
    const sidePanel = await openLogDetail(page);

    // Find a field to copy
    const field = sidePanel.locator(
      '[data-testid="field-row"]:has-text("service")',
    );
    await expect(field).toBeVisible();

    // Click field actions menu
    const fieldActionsButton = field.locator(
      '[data-testid="field-actions-button"]',
    );
    await fieldActionsButton.click();

    // Click "Copy value" action
    const copyAction = page.locator('[data-testid="copy-value-action"]');
    await copyAction.click();

    // Verify confirmation toast appears
    const toast = page.locator('text=Copied to clipboard');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('Test navigating between logs in side panel', async ({ page }) => {
    // Open log detail
    const sidePanel = await openLogDetail(page);

    // Get initial log ID or timestamp for comparison
    const initialLogId = await sidePanel
      .locator('[data-testid="log-detail-id"]')
      .innerText();

    // Click next log button
    const nextButton = sidePanel.locator('[data-testid="next-log-button"]');
    await expect(nextButton).toBeVisible();
    await nextButton.click();

    // Wait for panel to update
    await page.waitForTimeout(500);

    // Verify log has changed
    const newLogId = await sidePanel
      .locator('[data-testid="log-detail-id"]')
      .innerText();
    expect(newLogId).not.toEqual(initialLogId);

    // Click previous log button
    const prevButton = sidePanel.locator('[data-testid="previous-log-button"]');
    await prevButton.click();

    // Wait for panel to update
    await page.waitForTimeout(500);

    // Verify we're back to the initial log
    const backToInitialId = await sidePanel
      .locator('[data-testid="log-detail-id"]')
      .innerText();
    expect(backToInitialId).toEqual(initialLogId);
  });

  test('Test pattern detection from log', async ({ page }) => {
    // Open log detail
    const sidePanel = await openLogDetail(page);

    // Click on "Find pattern" button if available
    const patternButton = sidePanel.locator(
      '[data-testid="find-pattern-button"]',
    );
    if ((await patternButton.count()) > 0) {
      await patternButton.click();

      // Verify pattern dialog appears
      const patternDialog = page.locator('[data-testid="pattern-dialog"]');
      await expect(patternDialog).toBeVisible();

      // Apply pattern
      const applyButton = patternDialog.locator(
        '[data-testid="apply-pattern-button"]',
      );
      await applyButton.click();

      // Verify URL contains pattern search
      await expect(page.url()).toContain('pattern');
    } else {
      // Skip this test if pattern detection is not available
      test.skip();
    }
  });
});
