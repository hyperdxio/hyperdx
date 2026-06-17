import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

/**
 * Regression coverage for the "manually typed time resets to 00:00" bug.
 *
 * Before the fix, Mantine's DateInput (used in `DateInputCmp`) was invoked
 * without the `withTime` prop. Even though `valueFormat` included HH:mm:ss,
 * DateInput stripped the time portion on blur and normalized values to
 * midnight, so any manually typed Start/End time was lost.
 *
 * These tests type non-midnight times into the Start and End inputs and
 * assert the values survive both the immediate commit (Enter → blur) and a
 * full close/reopen of the picker popover.
 */
test.describe('Custom Time Range', { tag: '@custom-time-range' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await expect(searchPage.form).toBeVisible();
    await searchPage.timePicker.open();
    // Search page defaults to live/relative mode; switch to absolute so the
    // Range inputs become editable.
    await searchPage.timePicker.disableRelativeTime();
    // Guard against prior tests leaving the mode atom on "Around a time".
    await searchPage.timePicker.selectRangeMode();
  });

  test('should preserve manually typed Start and End times', async () => {
    const start = '2026-04-15 14:37:42';
    const end = '2026-04-15 15:09:11';

    await test.step('Type the datetimes into the inputs', async () => {
      await searchPage.timePicker.fillStartDate(start);
      await searchPage.timePicker.fillEndDate(end);
    });

    await test.step('Inputs retain the typed values before applying', async () => {
      await expect(searchPage.timePicker.startDateInput).toHaveValue(start);
      await expect(searchPage.timePicker.endDateInput).toHaveValue(end);
    });

    await test.step('Apply and confirm times propagate to the picker input', async () => {
      await searchPage.timePicker.apply();

      // The main picker input re-formats the range via date-fns, so the
      // literal YYYY-MM-DD HH:mm:ss string won't appear. Instead, assert
      // the typed HH:mm:ss components are present and the range is NOT
      // collapsed to two midnights (the old broken behavior).
      const inputValue = await searchPage.timePicker.input.inputValue();
      expect(inputValue).toContain('14:37:42');
      expect(inputValue).toContain('15:09:11');
    });

    await test.step('URL reflects an absolute range', async () => {
      await searchPage.page.waitForURL('**/search**from=**to=**');
      const url = searchPage.page.url();
      expect(url).toContain('from=');
      expect(url).toContain('to=');
      expect(url).toContain('isLive=false');
    });
  });

  test('should preserve typed times after closing and reopening the picker', async () => {
    const start = '2026-04-10 09:15:30';
    const end = '2026-04-10 11:45:20';

    await searchPage.timePicker.fillStartDate(start);
    await searchPage.timePicker.fillEndDate(end);
    await searchPage.timePicker.apply();

    await test.step('Reopen picker and verify inputs still show typed times', async () => {
      await searchPage.timePicker.open();
      await expect(searchPage.timePicker.startDateInput).toHaveValue(start);
      await expect(searchPage.timePicker.endDateInput).toHaveValue(end);
    });
  });

  test('should accept chrono natural-language times with non-midnight hours', async () => {
    // "dateParser" in utils.ts uses chrono-node; this spec guards that natural
    // language input still resolves to a non-midnight time after the fix.
    await searchPage.timePicker.fillStartDate('yesterday at 3:22 pm');
    // Format produced by the DateInput re-serialization is YYYY-MM-DD HH:mm:ss
    // (24h). 3:22 pm → 15:22.
    await expect(searchPage.timePicker.startDateInput).toHaveValue(/15:22/);
  });
});

/**
 * Regression coverage for the "date picker picks UTC midnight even in local
 * timezone mode" bug (HDX-4576).
 *
 * When the user has Local TZ selected and picks a date from the calendar,
 * the time should default to 00:00:00 in the local timezone (not 00:00:00
 * UTC). This test uses a non-UTC timezone to expose the difference.
 */
test.describe(
  'Calendar Date Picker Timezone',
  { tag: '@custom-time-range' },
  () => {
    test.use({ timezoneId: 'America/Los_Angeles' });

    test.describe('Local timezone mode', () => {
      let searchPage: SearchPage;

      test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
          window.localStorage.setItem(
            'hdx-user-preferences',
            JSON.stringify({
              isUTC: false,
              timeFormat: '24h',
              colorMode: 'dark',
              font: 'IBM Plex Mono',
            }),
          );
        });

        searchPage = new SearchPage(page);
        await page.goto('/search');
        await expect(searchPage.form).toBeVisible();
        await searchPage.timePicker.open();
        await searchPage.timePicker.disableRelativeTime();
        await searchPage.timePicker.selectRangeMode();
      });

      test('calendar date pick should use local timezone midnight', async ({
        page,
      }) => {
        await test.step('Pick a date from the calendar', async () => {
          await searchPage.timePicker.fillStartDate('2026-06-01 12:00:00');
          await searchPage.timePicker.pickStartDateFromCalendar(5);
        });

        await test.step('Verify the date input shows midnight local time', async () => {
          await expect(searchPage.timePicker.startDateInput).toHaveValue(
            '2026-06-05 00:00:00',
          );
        });

        await test.step('Set end date and apply', async () => {
          await searchPage.timePicker.fillEndDate('2026-06-05 23:59:59');
          await searchPage.timePicker.apply();
        });

        await test.step('URL from param corresponds to local midnight, not UTC midnight', async () => {
          await page.waitForURL('**/search**from=**to=**');
          const url = new URL(page.url());
          const fromEpoch = Number(url.searchParams.get('from'));

          // June 5, 2026 00:00:00 PDT (UTC-7) = June 5, 2026 07:00:00 UTC
          const expectedLocalMidnight = Date.UTC(2026, 5, 5, 7, 0, 0);
          // June 5, 2026 00:00:00 UTC (wrong if bug is present)
          const wrongUtcMidnight = Date.UTC(2026, 5, 5, 0, 0, 0);

          expect(fromEpoch).toBe(expectedLocalMidnight);
          expect(fromEpoch).not.toBe(wrongUtcMidnight);
        });
      });
    });

    test.describe('UTC mode', () => {
      let searchPage: SearchPage;

      test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
          window.localStorage.setItem(
            'hdx-user-preferences',
            JSON.stringify({
              isUTC: true,
              timeFormat: '24h',
              colorMode: 'dark',
              font: 'IBM Plex Mono',
            }),
          );
        });

        searchPage = new SearchPage(page);
        await page.goto('/search');
        await expect(searchPage.form).toBeVisible();
        await searchPage.timePicker.open();
        await searchPage.timePicker.disableRelativeTime();
        await searchPage.timePicker.selectRangeMode();
      });

      test('calendar date pick should use UTC midnight when isUTC is true', async ({
        page,
      }) => {
        await test.step('Pick a date from the calendar', async () => {
          await searchPage.timePicker.fillStartDate('2026-06-01 12:00:00');
          await searchPage.timePicker.pickStartDateFromCalendar(5);
        });

        await test.step('Verify the date input shows midnight (UTC context)', async () => {
          await expect(searchPage.timePicker.startDateInput).toHaveValue(
            '2026-06-05 00:00:00',
          );
        });

        await test.step('Set end date and apply', async () => {
          await searchPage.timePicker.fillEndDate('2026-06-05 23:59:59');
          await searchPage.timePicker.apply();
        });

        await test.step('URL from param corresponds to UTC midnight', async () => {
          await page.waitForURL('**/search**from=**to=**');
          const url = new URL(page.url());
          const fromEpoch = Number(url.searchParams.get('from'));

          // June 5, 2026 00:00:00 UTC
          const expectedUtcMidnight = Date.UTC(2026, 5, 5, 0, 0, 0);
          expect(fromEpoch).toBe(expectedUtcMidnight);
        });
      });
    });
  },
);
