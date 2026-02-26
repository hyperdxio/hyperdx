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
   * Set a custom time range and apply
   */
  async setCustomTimeRange(from: string, to: string) {
    await this.open();
    // This would need to be implemented based on actual UI
    // Just a placeholder for the pattern
    await this.page.getByTestId('custom-from').fill(from);
    await this.page.getByTestId('custom-to').fill(to);
    await this.apply();
  }
}
