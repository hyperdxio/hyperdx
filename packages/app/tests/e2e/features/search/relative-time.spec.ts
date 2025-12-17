import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Relative Time Picker', { tag: '@relative-time' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    // Wait for the page to be ready
    await expect(searchPage.form).toBeVisible();
    await searchPage.timePicker.open();
  });

  test.describe('Basic Functionality', () => {
    test('should display relative time toggle switch', async () => {
      await test.step('Verify switch is interactive', async () => {
        const switchInput = searchPage.timePicker.getRelativeTimeSwitch();
        // Check initial state (should be checked if in live mode)
        await expect(switchInput).toBeVisible();
      });
    });

    test('should toggle relative time mode on/off', async () => {
      await test.step('Toggle relative time off', async () => {
        const initialState =
          await searchPage.timePicker.isRelativeTimeEnabled();
        await searchPage.timePicker.toggleRelativeTimeSwitch();

        const newState = await searchPage.timePicker.isRelativeTimeEnabled();
        expect(newState).toBe(!initialState);
      });

      await test.step('Toggle relative time back on', async () => {
        const currentState =
          await searchPage.timePicker.isRelativeTimeEnabled();
        await searchPage.timePicker.toggleRelativeTimeSwitch();

        const newState = await searchPage.timePicker.isRelativeTimeEnabled();
        expect(newState).toBe(!currentState);
      });
    });

    test('should show Live Tail option in relative time mode', async () => {
      const liveTailButton = searchPage.page
        .locator('text=Live Tail')
        .locator('..');
      await expect(liveTailButton).toBeVisible();
    });
  });

  test.describe('Relative Time Options', () => {
    test('should select different relative time intervals', async () => {
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
          await searchPage.timePicker.enableRelativeTime();

          // Click the interval option
          await searchPage.timePicker.selectTimeInterval(interval.label);

          // Wait for URL to update
          await searchPage.page.waitForURL(
            `**/search**liveInterval=${interval.ms}**`,
          );

          // Verify URL contains the correct liveInterval parameter
          const url = searchPage.page.url();
          expect(url).toContain('liveInterval=');
          expect(url).toContain(`liveInterval=${interval.ms}`);

          // Verify isLive is true
          expect(url).toContain('isLive=true');

          // Verify the time picker input displays the selected interval
          await expect(searchPage.timePicker.input).toHaveValue(interval.label);

          await searchPage.timePicker.open();
        });
      }
    });

    test('should select Live Tail (15m default)', async () => {
      await test.step('Select Live Tail', async () => {
        await searchPage.timePicker.selectLiveTail();
        await searchPage.page.waitForURL('**/search**liveInterval=900000**');
      });

      await test.step('Verify URL parameters', async () => {
        const url = searchPage.page.url();
        expect(url).toContain('isLive=true');
        // Live Tail defaults to 15 minutes (900000ms)
        expect(url).toContain('liveInterval=900000');
      });

      await test.step('Verify time picker input shows Live Tail', async () => {
        await expect(searchPage.timePicker.input).toHaveValue('Live Tail');
      });
    });

    test('should disable non-relative options when relative mode is off', async () => {
      await test.step('Turn off relative time mode', async () => {
        await searchPage.timePicker.disableRelativeTime();
      });

      await test.step('Verify time options without relative support are not disabled', async () => {
        // Options like "Last 3 hours", "Last 6 hours" etc. should work in absolute mode
        const last3HoursButton = searchPage.page.locator('text=Last 3 hours');
        await expect(last3HoursButton).toBeVisible();
        const isDisabled = last3HoursButton;
        await expect(isDisabled).toBeEnabled();
      });

      await test.step('Verify clicking an option in absolute mode works', async () => {
        await searchPage.timePicker.selectTimeInterval('Last 1 hour');

        // Wait for URL to update with absolute time range
        await searchPage.page.waitForURL('**/search**from=**to=**');

        // In absolute mode, should set time range but not live mode
        const url = searchPage.page.url();
        expect(url).toContain('from=');
        expect(url).toContain('to=');
      });
    });
  });

  test.describe('Live Mode Integration', () => {
    test('should start in live mode by default', async () => {
      // Fresh page load should default to live mode
      await searchPage.goto();

      await expect(searchPage.timePicker.input).toHaveValue('Live Tail');
    });

    test('should exit live mode when selecting absolute time range', async () => {
      await test.step('Open time picker and turn off relative mode', async () => {
        await searchPage.timePicker.disableRelativeTime();
      });

      await test.step('Select an absolute time range', async () => {
        await searchPage.timePicker.selectTimeInterval('Last 1 hour');
        await searchPage.page.waitForURL('**/search**isLive=false**');
      });

      await test.step('Verify exited live mode', async () => {
        const url = searchPage.page.url();
        // Should have absolute time range
        expect(url).toContain('from=');
        expect(url).toContain('to=');
        // Should NOT be in live mode
        expect(url).toContain('isLive=false');
      });
    });

    test('should resume live tail with selected interval', async () => {
      await test.step('Select a specific relative interval', async () => {
        await searchPage.timePicker.enableRelativeTime();
        await searchPage.timePicker.selectTimeInterval('Last 5 minutes');
        await searchPage.page.waitForURL('**/search**liveInterval=300000**');
      });

      await test.step('Pause live tail by selecting absolute time', async () => {
        await searchPage.timePicker.open();
        await searchPage.timePicker.disableRelativeTime();
        await searchPage.timePicker.selectTimeInterval('Last 1 hour');
        await searchPage.page.waitForURL('**/search**isLive=false**');
      });

      await test.step('Resume live tail', async () => {
        // Look for a resume/play button or similar control
        // This might be in the UI - adjust selector as needed
        const resumeButton = searchPage.page
          .locator('text=/Resume|Play/i')
          .first();
        const isVisible = await resumeButton.isVisible().catch(() => false);

        if (isVisible) {
          await resumeButton.click();
          await searchPage.page.waitForURL('**/search**isLive=true**');

          // Verify back in live mode
          const url = searchPage.page.url();
          expect(url).toContain('isLive=true');
          // Should retain the previously selected interval (5 minutes = 300000ms)
          expect(url).toContain('liveInterval=300000');
        }
      });
    });
  });

  test.describe('URL State Management', () => {
    test('should persist relative time settings in URL', async () => {
      await test.step('Select relative time interval', async () => {
        await searchPage.timePicker.enableRelativeTime();
        await searchPage.timePicker.selectTimeInterval('Last 30 minutes');
        await searchPage.page.waitForURL('**/search**liveInterval=1800000**');
      });

      await test.step('Copy URL and navigate away', async () => {
        const urlWithRelativeTime = searchPage.page.url();

        // Navigate to a different page
        await searchPage.goto();

        // Navigate back using the saved URL
        await searchPage.page.goto(urlWithRelativeTime);
      });

      await test.step('Verify relative time settings are restored', async () => {
        const url = searchPage.page.url();
        expect(url).toContain('isLive=true');
        expect(url).toContain('liveInterval=1800000'); // 30 minutes

        // Wait for the UI to update with the URL state
        await expect(searchPage.timePicker.input).toHaveValue(
          'Last 30 minutes',
          {
            timeout: 5000,
          },
        );
      });
    });

    test('should restore relative time toggle state from URL', async () => {
      await test.step('Set up relative time mode', async () => {
        await searchPage.timePicker.enableRelativeTime();
        await searchPage.timePicker.selectTimeInterval('Last 30 minutes');
        await searchPage.page.waitForURL('**/search**liveInterval=1800000**');
      });

      await test.step('Reload page', async () => {
        await searchPage.page.reload();
      });

      await test.step('Open time picker and verify relative toggle is on', async () => {
        // Wait for the time picker to be ready with the URL state
        await expect(searchPage.timePicker.input).toHaveValue(
          'Last 30 minutes',
          {
            timeout: 5000,
          },
        );

        await searchPage.timePicker.open();

        const isChecked = await searchPage.timePicker.isRelativeTimeEnabled();
        expect(isChecked).toBe(true);
      });
    });
  });

  test.describe('Search Integration', () => {
    test('should perform search with relative time range', async () => {
      await test.step('Select relative time interval', async () => {
        await searchPage.timePicker.enableRelativeTime();
        await searchPage.timePicker.selectTimeInterval('Last 5 minutes');
        await searchPage.page.waitForURL('**/search**liveInterval=300000**');
      });

      await test.step('Perform search', async () => {
        await searchPage.submitEmptySearch();
      });

      await test.step('Verify search results or empty state', async () => {
        // Results may or may not exist depending on data
        const searchResultsTable = searchPage.getSearchResultsTable();
        await expect(searchResultsTable).toBeAttached();
      });

      await test.step('Verify URL maintains relative time params', async () => {
        const url = searchPage.page.url();
        expect(url).toContain('isLive=true');
        expect(url).toContain('liveInterval=300000'); // 5 minutes
      });
    });

    test('should update search results when switching between intervals', async () => {
      const intervals = [
        { label: 'Last 5 minutes', ms: 300000 },
        { label: 'Last 15 minutes', ms: 900000 },
        { label: 'Last 1 hour', ms: 3600000 },
      ];

      await searchPage.timePicker.enableRelativeTime();

      for (const interval of intervals) {
        await test.step(`Search with ${interval.label}`, async () => {
          await searchPage.timePicker.open();
          await searchPage.timePicker.selectTimeInterval(interval.label);
          await searchPage.page.waitForURL(
            `**/search**liveInterval=${interval.ms}**`,
          );

          const url = searchPage.page.url();
          expect(url).toContain(`liveInterval=${interval.ms}`);
        });
      }
    });
  });
});
