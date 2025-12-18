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
   */
  async open() {
    await this.pickerInput.click();
    await this.pickerPopover.waitFor({ state: 'visible' });
  }

  /**
   * Close the time picker dropdown
   */
  async close() {
    await this.pickerCloseButton.click();
  }

  /**
   * Toggle the relative time switch
   */
  async toggleRelativeTimeSwitch() {
    // Click parent element to trigger the switch
    await this.relativeTimeSwitch.locator('..').click();
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
   */
  async selectTimeInterval(label: string) {
    const intervalButton = this.page.locator(`text=${label}`);
    await intervalButton.click();
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
    await this.picker1HourBack.click();
  }

  /**
   * Navigate forward 1 hour
   */
  async goForward1Hour() {
    await this.open();
    await this.picker1HourForward.click();
  }

  /**
   * Apply the selected time range
   */
  async apply() {
    await this.pickerApplyButton.click();
  }

  /**
   * Set a custom time range and apply
   */
  async setCustomTimeRange(from: string, to: string) {
    await this.open();
    // This would need to be implemented based on actual UI
    // Just a placeholder for the pattern
    await this.page.locator('[data-testid="custom-from"]').fill(from);
    await this.page.locator('[data-testid="custom-to"]').fill(to);
    await this.apply();
  }
}
