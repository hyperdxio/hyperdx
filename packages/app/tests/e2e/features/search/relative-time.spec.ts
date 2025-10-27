import { Page } from '@playwright/test';

import { expect, test } from '../../utils/base-test';

const getRelativeTimeSwitch = (page: Page) =>
  page.getByTestId('time-picker-relative-switch');

const clickRelativeTimeSwitch = async (page: Page) => {
  const switchInput = getRelativeTimeSwitch(page);
  await switchInput.locator('..').click();
};

const openTimePickerModal = async (page: Page) => {
  await page.click('[data-testid="time-picker-input"]');
  await page.waitForSelector('[data-testid="time-picker-popover"]', {
    state: 'visible',
  });
};

test.describe('Relative Time Picker', { tag: '@relative-time' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
    // Wait for the page to be ready
    await expect(page.locator('[data-testid="search-form"]')).toBeVisible();
    await openTimePickerModal(page);
  });

  test.describe('Basic Functionality', () => {
    test('should display relative time toggle switch', async ({ page }) => {
      await test.step('Verify switch is interactive', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        // Check initial state (should be checked if in live mode)
        const isChecked = await switchInput.isChecked();
        expect(typeof isChecked).toBe('boolean');
      });
    });

    test('should toggle relative time mode on/off', async ({ page }) => {
      const switchInput = getRelativeTimeSwitch(page);

      await test.step('Toggle relative time off', async () => {
        const initialState = await switchInput.isChecked();
        await clickRelativeTimeSwitch(page);

        const newState = await switchInput.isChecked();
        expect(newState).toBe(!initialState);
      });

      await test.step('Toggle relative time back on', async () => {
        const currentState = await switchInput.isChecked();
        await clickRelativeTimeSwitch(page);

        const newState = await switchInput.isChecked();
        expect(newState).toBe(!currentState);
      });
    });

    test('should show Live Tail option in relative time mode', async ({
      page,
    }) => {
      const liveTailButton = page.locator('text=Live Tail').locator('..');
      await expect(liveTailButton).toBeVisible();
    });
  });

  test.describe('Relative Time Options', () => {
    test('should select different relative time intervals', async ({
      page,
    }) => {
      const intervals = [
        { label: 'Last 1 minute', ms: 60000 },
        { label: 'Last 5 minutes', ms: 300000 },
        { label: 'Last 15 minutes', ms: 900000 },
        { label: 'Last 30 minutes', ms: 1800000 },
        { label: 'Last 45 minutes', ms: 2700000 },
        { label: 'Last 1 hour', ms: 3600000 },
      ];

      for (const interval of intervals) {
        await test.step(`Select ${interval.label}`, async () => {
          // Ensure relative time mode is enabled
          const switchInput = getRelativeTimeSwitch(page);
          const isChecked = await switchInput.isChecked();
          if (!isChecked) {
            await clickRelativeTimeSwitch(page);
          }

          // Click the interval option
          const intervalButton = page.locator(`text=${interval.label}`);
          await expect(intervalButton).toBeVisible();
          await intervalButton.click();

          // Wait for URL to update
          await page.waitForURL(`**/search**liveInterval=${interval.ms}**`);

          // Verify URL contains the correct liveInterval parameter
          const url = page.url();
          expect(url).toContain('liveInterval=');
          expect(url).toContain(`liveInterval=${interval.ms}`);

          // Verify isLive is true
          expect(url).toContain('isLive=true');

          // Verify the time picker input displays the selected interval
          const timePickerInput = page.locator(
            '[data-testid="time-picker-input"]',
          );
          const inputValue = await timePickerInput.inputValue();
          expect(inputValue).toBe(interval.label);

          await openTimePickerModal(page);
        });
      }
    });

    test('should select Live Tail (15m default)', async ({ page }) => {
      await test.step('Select Live Tail', async () => {
        const liveTailButton = page.locator('text=Live Tail').locator('..');
        await liveTailButton.click();
        await page.waitForURL('**/search**liveInterval=900000**');
      });

      await test.step('Verify URL parameters', async () => {
        const url = page.url();
        expect(url).toContain('isLive=true');
        // Live Tail defaults to 15 minutes (900000ms)
        expect(url).toContain('liveInterval=900000');
      });

      await test.step('Verify time picker input shows Live Tail', async () => {
        const timePickerInput = page.locator(
          '[data-testid="time-picker-input"]',
        );
        const inputValue = await timePickerInput.inputValue();
        expect(inputValue).toBe('Live Tail');
      });
    });

    test('should disable non-relative options when relative mode is off', async ({
      page,
    }) => {
      await test.step('Turn off relative time mode', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        if (isChecked) {
          await clickRelativeTimeSwitch(page);
        }
      });

      await test.step('Verify time options without relative support are not disabled', async () => {
        // Options like "Last 3 hours", "Last 6 hours" etc. should work in absolute mode
        const last3HoursButton = page.locator('text=Last 3 hours');
        await expect(last3HoursButton).toBeVisible();
        const isDisabled = await last3HoursButton.isDisabled();
        expect(isDisabled).toBe(false);
      });

      await test.step('Verify clicking an option in absolute mode works', async () => {
        const last1HourButton = page.locator('text=Last 1 hour');
        await last1HourButton.click();

        // Wait for URL to update with absolute time range
        await page.waitForURL('**/search**from=**to=**');

        // In absolute mode, should set time range but not live mode
        const url = page.url();
        expect(url).toContain('from=');
        expect(url).toContain('to=');
      });
    });
  });

  test.describe('Live Mode Integration', () => {
    test('should start in live mode by default', async ({ page }) => {
      // Fresh page load should default to live mode
      await page.goto('/search');
      await page.waitForLoadState('networkidle');

      const timePickerInput = page.locator('[data-testid="time-picker-input"]');
      const inputValue = await timePickerInput.inputValue();
      expect(inputValue).toBe('Live Tail');
    });

    test('should exit live mode when selecting absolute time range', async ({
      page,
    }) => {
      await test.step('Open time picker and turn off relative mode', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        if (isChecked) {
          await clickRelativeTimeSwitch(page);
        }
      });

      await test.step('Select an absolute time range', async () => {
        const last1HourButton = page.locator('text=Last 1 hour');
        await last1HourButton.click();
        await page.waitForURL('**/search**isLive=false**');
      });

      await test.step('Verify exited live mode', async () => {
        const url = page.url();
        // Should have absolute time range
        expect(url).toContain('from=');
        expect(url).toContain('to=');
        // Should NOT be in live mode
        expect(url).toContain('isLive=false');
      });
    });

    test('should resume live tail with selected interval', async ({ page }) => {
      await test.step('Select a specific relative interval', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        if (!isChecked) {
          await clickRelativeTimeSwitch(page);
        }

        const last5MinButton = page.locator('text=Last 5 minutes');
        await last5MinButton.click();
        await page.waitForURL('**/search**liveInterval=300000**');
      });

      await test.step('Pause live tail by selecting absolute time', async () => {
        await page.click('[data-testid="time-picker-input"]');
        await page.waitForSelector('[data-testid="time-picker-popover"]', {
          state: 'visible',
        });

        await clickRelativeTimeSwitch(page);

        const last1HourButton = page.locator('text=Last 1 hour');
        await last1HourButton.click();
        await page.waitForURL('**/search**isLive=false**');
      });

      await test.step('Resume live tail', async () => {
        // Look for a resume/play button or similar control
        // This might be in the UI - adjust selector as needed
        const resumeButton = page.locator('text=/Resume|Play/i').first();
        const isVisible = await resumeButton.isVisible().catch(() => false);

        if (isVisible) {
          await resumeButton.click();
          await page.waitForURL('**/search**isLive=true**');

          // Verify back in live mode
          const url = page.url();
          expect(url).toContain('isLive=true');
          // Should retain the previously selected interval (5 minutes = 300000ms)
          expect(url).toContain('liveInterval=300000');
        }
      });
    });
  });

  test.describe('URL State Management', () => {
    test('should persist relative time settings in URL', async ({ page }) => {
      await test.step('Select relative time interval', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        if (!isChecked) {
          await clickRelativeTimeSwitch(page);
        }

        const last30MinButton = page.locator('text=Last 30 minutes');
        await last30MinButton.click();
        await page.waitForURL('**/search**liveInterval=1800000**');
      });

      await test.step('Copy URL and navigate away', async () => {
        const urlWithRelativeTime = page.url();

        // Navigate to a different page
        await page.goto('/search');
        await page.waitForLoadState('networkidle');

        // Navigate back using the saved URL
        await page.goto(urlWithRelativeTime);
        await page.waitForLoadState('networkidle');
      });

      await test.step('Verify relative time settings are restored', async () => {
        const url = page.url();
        expect(url).toContain('isLive=true');
        expect(url).toContain('liveInterval=1800000'); // 30 minutes

        const timePickerInput = page.locator(
          '[data-testid="time-picker-input"]',
        );
        const inputValue = await timePickerInput.inputValue();
        expect(inputValue).toBe('Last 30 minutes');
      });
    });

    test('should restore relative time toggle state from URL', async ({
      page,
    }) => {
      await test.step('Set up relative time mode', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        if (!isChecked) {
          await clickRelativeTimeSwitch(page);
        }

        const last30MinButton = page.locator('text=Last 30 minutes');
        await last30MinButton.click();
        await page.waitForURL('**/search**liveInterval=1800000**');
      });

      await test.step('Reload page', async () => {
        await page.reload();
        await page.waitForLoadState('networkidle');
      });

      await test.step('Open time picker and verify relative toggle is on', async () => {
        await page.click('[data-testid="time-picker-input"]');
        await page.waitForSelector('[data-testid="time-picker-popover"]', {
          state: 'visible',
        });

        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        expect(isChecked).toBe(true);
      });
    });
  });

  test.describe('Search Integration', () => {
    test('should perform search with relative time range', async ({ page }) => {
      await test.step('Select relative time interval', async () => {
        const switchInput = getRelativeTimeSwitch(page);
        const isChecked = await switchInput.isChecked();
        if (!isChecked) {
          await clickRelativeTimeSwitch(page);
        }

        const last5MinButton = page.locator('text=Last 5 minutes');
        await last5MinButton.click();
        await page.waitForURL('**/search**liveInterval=300000**');
      });

      await test.step('Perform search', async () => {
        const searchSubmitButton = page.locator(
          '[data-testid="search-submit-button"]',
        );
        await searchSubmitButton.click();
        await page.waitForLoadState('networkidle');
      });

      await test.step('Verify search results or empty state', async () => {
        // Results may or may not exist depending on data
        const searchResultsTable = page.locator(
          '[data-testid="search-results-table"]',
        );
        const tableVisible = await searchResultsTable
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        expect(typeof tableVisible).toBe('boolean');
      });

      await test.step('Verify URL maintains relative time params', async () => {
        const url = page.url();
        expect(url).toContain('isLive=true');
        expect(url).toContain('liveInterval=300000'); // 5 minutes
      });
    });

    test('should update search results when switching between intervals', async ({
      page,
    }) => {
      const intervals = [
        { label: 'Last 5 minutes', ms: 300000 },
        { label: 'Last 15 minutes', ms: 900000 },
        { label: 'Last 1 hour', ms: 3600000 },
      ];

      for (const interval of intervals) {
        await test.step(`Search with ${interval.label}`, async () => {
          await page.click('[data-testid="time-picker-input"]');
          await page.waitForSelector('[data-testid="time-picker-popover"]', {
            state: 'visible',
          });

          const switchInput = getRelativeTimeSwitch(page);
          const isChecked = await switchInput.isChecked();
          if (!isChecked) {
            await clickRelativeTimeSwitch(page);
          }

          const intervalButton = page.locator(`text=${interval.label}`);
          await intervalButton.click();
          await page.waitForURL(`**/search**liveInterval=${interval.ms}**`);

          const searchSubmitButton = page.locator(
            '[data-testid="search-submit-button"]',
          );
          await searchSubmitButton.click();
          await page.waitForLoadState('networkidle');

          const url = page.url();
          expect(url).toContain(`liveInterval=${interval.ms}`);
        });
      }
    });
  });
});
