/**
 * TimePickerComponent - Reusable component for time range selection
 * Used across Search, Dashboard, Logs, Traces, and other time-filtered pages
 */
import { Locator, Page } from '@playwright/test';

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
    const isOpen = await this.pickerPopover.isVisible();
    if (isOpen) return;
    await this.page.waitForLoadState('networkidle');
    await this.page.keyboard.press('Escape');
    await this.pickerInput.click();
    await this.pickerPopover.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Close the time picker dropdown
   */
  async close() {
    await this.pickerCloseButton.click({ timeout: 5000 });
  }

  /**
   * Toggle the relative time switch
   */
  async toggleRelativeTimeSwitch() {
    // Click parent element to trigger the switch
    await this.relativeTimeSwitch.locator('..').click({ timeout: 5000 });
  }

  /**
   * Check if relative time mode is enabled
   */
  async isRelativeTimeEnabled(): Promise<boolean> {
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
    // Wait for the specific button to be visible before clicking.
    // Avoid calling waitForLoadState('networkidle') here — the popover is
    // already open from open(), and waiting for network idle can coincide
    // with React re-renders of the popover content, causing the button to
    // briefly detach from the DOM right before the click.
    await intervalButton.waitFor({ state: 'visible', timeout: 5000 });
    // Use a longer click timeout so Playwright can retry if the element
    // briefly detaches due to an ongoing render cycle.
    await intervalButton.click({ timeout: 10000 });
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
   * Apply the selected time range
   */
  async apply() {
    await this.pickerApplyButton.click({ timeout: 5000 });
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
