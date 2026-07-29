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
    // The picker mode is persisted in localStorage via an atomWithStorage
    // ('hdx-time-picker-mode'), so a prior test that switched to "Around a
    // time" can leak into this one and leave the picker mounted with a single
    // date input. Reset the key before any page script runs so the picker
    // always mounts in the default Range mode.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('hdx-time-picker-mode');
      } catch {
        // localStorage may be unavailable in some contexts; ignore.
      }
    });
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
      // Range mode (two date inputs) is guaranteed because the beforeEach
      // resets the persisted 'hdx-time-picker-mode' atom and selects Range
      // mode, and applying an absolute range leaves isLive=false (absolute
      // mode). Both Start and End inputs are therefore present here.
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
