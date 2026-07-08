/**
 * TimePickerComponent - Reusable component for time range selection
 * Used across Search, Dashboard, Logs, Traces, and other time-filtered pages
 */
import { expect, Locator, Page } from '@playwright/test';

export class TimePickerComponent {
  readonly page: Page;
  private readonly pickerInput: Locator;
  private readonly pickerPopover: Locator;
  private readonly pickerApplyButton: Locator;
  private readonly pickerCloseButton: Locator;
  private readonly picker1HourBack: Locator;
  private readonly picker1HourForward: Locator;
  private readonly relativeTimeSwitch: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pickerInput = page.getByTestId('time-picker-input');
    this.pickerPopover = page.getByTestId('time-picker-popover');
    this.pickerApplyButton = page.getByTestId('time-picker-apply');
    this.pickerCloseButton = page.getByTestId('time-picker-close');
    this.picker1HourBack = page.getByTestId('time-picker-1h-back');
    this.picker1HourForward = page.getByTestId('time-picker-1h-forward');
    this.relativeTimeSwitch = page.getByTestId('time-picker-relative-switch');
  }

  /**
   * Get the time picker input element
   * Usage in spec: await expect(timePicker.input).toBeVisible()
   */
  get input() {
    return this.pickerInput;
  }

  /**
   * Get the apply button
   */
  get applyButton() {
    return this.pickerApplyButton;
  }

  /**
   * Get the close button
   */
  get closeButton() {
    return this.pickerCloseButton;
  }

  /**
   * Get the time picker popover
   */
  get popover() {
    return this.pickerPopover;
  }

  /**
   * Get the relative time switch input
   */
  getRelativeTimeSwitch() {
    return this.relativeTimeSwitch;
  }

  /**
   * Open the time picker dropdown
   * Idempotent: if the popover is already open, does nothing.
   * Clicking the input when the popover is already open would close it.
   */
  async open() {
    await this.page.waitForLoadState('networkidle');

    // The input toggles the popover, so this method must end in a *stably
    // open* state. The tricky cases this loop handles:
    //  - Already open and stable → nothing to do.
    //  - Closed → one click opens it.
    //  - Mid-close (still visible but about to detach, e.g. right after
    //    selectTimeInterval()'s handleRelativeSearch → close()) → an early
    //    return here would hand back a popover that then vanishes. We instead
    //    wait for it to settle to a stable hidden state, then click to open.
    //  - Click swallowed by a React re-render → retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await this.isPopoverStablyOpen()) return;

      // Settle to a clean hidden baseline before toggling open. If it's
      // genuinely open-and-stable the check above already returned; if it's
      // closing, wait for hidden so our click reopens rather than re-closes.
      await this.pickerPopover
        .waitFor({ state: 'hidden', timeout: 2000 })
        .catch(() => {
          // Either already hidden or still finishing an open; the stability
          // check at the top of the next iteration will sort it out.
        });

      // The popover is closed here, so it is safe to press Escape to dismiss
      // any overlay that would intercept the toggle click — most importantly
      // the search input's autocomplete dropdown ("Searching for:" portal),
      // which renders on top of the time-picker input after typing a query
      // (e.g. traces-workflow types "Order" then opens the picker). Escape is
      // only pressed from this closed baseline, so it can't race a just-opened
      // popover shut.
      await this.page.keyboard.press('Escape');

      await this.pickerInput.click();
      if (await this.isPopoverStablyOpen()) return;
    }
    // Surface a clear failure if it still hasn't opened.
    await this.pickerPopover.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * True only if the popover is visible and *stays* visible briefly afterwards
   * — i.e. it is not in the middle of a close transition. Used by open() to
   * avoid returning a popover that is about to detach.
   */
  private async isPopoverStablyOpen(): Promise<boolean> {
    if (!(await this.pickerPopover.isVisible())) return false;
    // Dwell long enough to outlast the post-apply / post-select re-render
    // cascade (URL update + results reload) that can close a just-opened
    // popover. Sample twice so a mid-cascade flicker is caught.
    await this.page.waitForTimeout(250);
    if (!(await this.pickerPopover.isVisible())) return false;
    await this.page.waitForTimeout(250);
    return await this.pickerPopover.isVisible();
  }

  /**
   * Close the time picker dropdown
   */
  async close() {
    await this.pickerCloseButton.click({ timeout: 5000 });
  }

  /**
   * Toggle the relative time switch and wait until its checked state actually
   * flips.
   *
   * Mantine renders the switch as a visually-hidden <input> whose immediate
   * parent (`..`) is the clickable track. Clicking that toggles the switch.
   * Immediately after the popover re-opens the track can still be settling, so
   * a single click occasionally doesn't register — retry until the checked
   * state changes (re-opening the popover between attempts if it closed).
   */
  async toggleRelativeTimeSwitch() {
    await this.relativeTimeSwitch.waitFor({ state: 'attached', timeout: 5000 });
    const before = await this.relativeTimeSwitch.isChecked();
    const track = this.relativeTimeSwitch.locator('..');
    for (let attempt = 0; attempt < 4; attempt++) {
      await track.click({ timeout: 5000 });
      try {
        await expect(this.relativeTimeSwitch).toBeChecked({
          checked: !before,
          timeout: 2000,
        });
        return;
      } catch {
        // Click didn't register (popover re-render); ensure it's open and retry.
        await this.open();
      }
    }
    await expect(this.relativeTimeSwitch).toBeChecked({ checked: !before });
  }

  /**
   * Check if relative time mode is enabled.
   *
   * The relative-time switch only renders while the popover is open. Wait for
   * it to attach before reading `isChecked()` so a closed/transitioning
   * popover fails fast with a clear error instead of hanging until the 60s
   * test timeout.
   */
  async isRelativeTimeEnabled(): Promise<boolean> {
    await this.relativeTimeSwitch.waitFor({ state: 'attached', timeout: 5000 });
    return await this.relativeTimeSwitch.isChecked();
  }

  /**
   * Enable relative time mode (if not already enabled)
   */
  async enableRelativeTime() {
    const isEnabled = await this.isRelativeTimeEnabled();
    if (!isEnabled) {
      await this.toggleRelativeTimeSwitch();
    }
  }

  /**
   * Disable relative time mode (if not already disabled)
   */
  async disableRelativeTime() {
    const isEnabled = await this.isRelativeTimeEnabled();
    if (isEnabled) {
      await this.toggleRelativeTimeSwitch();
    }
  }

  /**
   * Select a time interval option by label (e.g., "Last 1 hour", "Last 6 hours", "Live Tail")
   * Precondition: the time picker popover must already be open (call open() first).
   */
  async selectTimeInterval(label: string) {
    // Scope button search within the popover to avoid matching buttons elsewhere on the page
    const intervalButton = this.pickerPopover.getByRole('button', {
      name: label,
    });
    // The popover content re-renders (the previously-selected option flips its
    // Mantine variant, the whole list reconciles), which can detach the target
    // button mid-click. A single click() with a long timeout still fails if
    // the element it resolved goes stale during the actionability wait, so
    // retry the visible-wait + click as a unit until it lands.
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await intervalButton.waitFor({ state: 'visible', timeout: 5000 });
        await intervalButton.click({ timeout: 5000 });
        return;
      } catch (error) {
        lastError = error;
        // The popover may have closed (e.g. a swallowed render); make sure it
        // is open again before the next attempt.
        await this.open();
      }
    }
    throw lastError;
  }

  /**
   * Select Live Tail option
   */
  async selectLiveTail() {
    await this.selectTimeInterval('Live Tail');
  }

  /**
   * Select a relative time option (e.g., "Last 1 hour", "Last 6 hours")
   * Opens the picker first if not already open
   */
  async selectRelativeTime(timeRange: string) {
    await this.open();
    await this.selectTimeInterval(timeRange);
  }

  /**
   * Navigate backwards 1 hour
   */
  async goBack1Hour() {
    await this.open();
    await this.picker1HourBack.click({ timeout: 5000 });
  }

  /**
   * Navigate forward 1 hour
   */
  async goForward1Hour() {
    await this.open();
    await this.picker1HourForward.click({ timeout: 5000 });
  }

  /**
   * Apply the selected time range.
   *
   * handleApply() runs the search and then closes the popover, which kicks off
   * a re-render cascade (URL update, results reload). Wait for the popover to
   * actually close so callers that immediately re-open it (e.g. the
   * close/reopen regression test) start from a settled, closed state instead
   * of racing the in-flight close.
   */
  async apply() {
    await this.pickerApplyButton.click({ timeout: 5000 });
    await this.pickerPopover
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {
        // If it never reports hidden, open()'s own settling logic will cope.
      });
    await this.page.waitForLoadState('networkidle').catch(() => {
      // Network may stay busy (live tail); proceeding is safe.
    });
  }

  /**
   * Locator for the Start time / "Time" DateInput inside the picker popover.
   * Both Start and End inputs share the same placeholder, so we disambiguate
   * by ordinal. In Range mode this is the first DateInput; in Around mode
   * the single DateInput is also the first (and only).
   */
  get startDateInput() {
    return this.pickerPopover.getByPlaceholder('YYYY-MM-DD HH:mm:ss').nth(0);
  }

  /**
   * Locator for the End time DateInput. Only present in Range mode.
   */
  get endDateInput() {
    return this.pickerPopover.getByPlaceholder('YYYY-MM-DD HH:mm:ss').nth(1);
  }

  /**
   * Switch the picker to "Time range" mode (two date inputs).
   * Safe to call when already in Range mode (SegmentedControl is idempotent).
   *
   * Mantine's SegmentedControl visually hides the underlying radio inputs,
   * so `getByRole('radio')` resolves to an element that Playwright considers
   * not visible. Click the associated label instead — same pattern as
   * ChartEditorComponent.switchToSqlMode().
   */
  async selectRangeMode() {
    const rangeLabel = this.pickerPopover.locator(
      '.mantine-SegmentedControl-label:has-text("Time range")',
    );
    await rangeLabel.waitFor({ state: 'visible', timeout: 5000 });
    await rangeLabel.click();
  }

  /**
   * Fill the Start time (or, in Around mode, the "Time") input with a
   * datetime string. Uses fill() + Enter to trigger the component's blur
   * handler, which commits the parsed value back to form state.
   */
  async fillStartDate(value: string) {
    await this.startDateInput.fill(value);
    await this.startDateInput.press('Enter');
  }

  /**
   * Fill the End time input with a datetime string. Only valid in Range mode.
   */
  async fillEndDate(value: string) {
    await this.endDateInput.fill(value);
    await this.endDateInput.press('Enter');
  }

  /**
   * Set a custom absolute time range via the Start/End inputs and apply.
   * Assumes the popover is already open and relative mode is disabled.
   */
  async setCustomTimeRange(from: string, to: string) {
    await this.fillStartDate(from);
    await this.fillEndDate(to);
    await this.apply();
  }
}
