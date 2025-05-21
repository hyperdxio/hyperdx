import { expect, Page } from '@playwright/test';

/**
 * Select a predefined time range from the time picker
 */
export async function selectTimeRange(page: Page, rangeText: string) {
  const timePicker = page.locator('[data-testid="time-picker-input"]');
  await expect(timePicker).toBeVisible();
  await timePicker.click();

  const timeOption = page.getByRole('option', { name: rangeText });
  await expect(timeOption).toBeVisible();
  await timeOption.click();

  // Verify the time picker shows the selected range
  await expect(timePicker).toContainText(rangeText);

  // Wait for the page to reload with the new time range
  await page.waitForLoadState('networkidle');
}

/**
 * Set a custom time range with start and end dates
 */
export async function setCustomTimeRange(page: Page, start: Date, end: Date) {
  const timePicker = page.locator('[data-testid="time-picker-input"]');
  await timePicker.click();

  // Click custom time range option
  const customOption = page.getByRole('option', { name: 'Custom Range' });
  await customOption.click();

  // Format dates as required by the date picker
  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const formatTime = (date: Date) => {
    return date.toTimeString().split(' ')[0].substring(0, 5);
  };

  // Fill start date and time
  const startDateInput = page.locator('[data-testid="start-date-input"]');
  await startDateInput.fill(formatDate(start));

  const startTimeInput = page.locator('[data-testid="start-time-input"]');
  await startTimeInput.fill(formatTime(start));

  // Fill end date and time
  const endDateInput = page.locator('[data-testid="end-date-input"]');
  await endDateInput.fill(formatDate(end));

  const endTimeInput = page.locator('[data-testid="end-time-input"]');
  await endTimeInput.fill(formatTime(end));

  // Apply the custom range
  const applyButton = page.locator('[data-testid="apply-custom-range-button"]');
  await applyButton.click();

  // Wait for the page to reload with the new time range
  await page.waitForLoadState('networkidle');
}

/**
 * Check if the Live Tail mode is active
 */
export async function isLiveTailActive(page: Page): Promise<boolean> {
  const timePickerInput = page.locator('[data-testid="time-picker-input"]');
  await expect(timePickerInput).toBeVisible();

  const text = await timePickerInput.inputValue();
  return text.includes('Live Tail');
}

/**
 * Toggle between Live Tail and historical view
 */
export async function toggleLiveTail(page: Page, enable: boolean) {
  const isCurrentlyLive = await isLiveTailActive(page);

  if (enable && !isCurrentlyLive) {
    const resumeLiveButton = page.locator(
      '[data-testid="resume-live-tail-button"]',
    );
    await resumeLiveButton.click();
    await page.waitForURL('**/search?isLive=true*');
  } else if (!enable && isCurrentlyLive) {
    // To disable live tail, we need to scroll the log table
    const tableContainer = page.locator(
      '[data-testid="search-table-container"]',
    );
    await tableContainer.evaluate((container: HTMLElement) => {
      container.scrollTop += 200;
    });
    await page.waitForURL('**/search?isLive=false*');
  }
}

/**
 * Get the current time range displayed in the UI
 */
export async function getCurrentTimeRange(page: Page): Promise<string> {
  const timePickerInput = page.locator('[data-testid="time-picker-input"]');
  await expect(timePickerInput).toBeVisible();

  return await timePickerInput.inputValue();
}
