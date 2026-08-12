/**
 * LabsModalComponent - the "HyperDX Labs" modal opened from the nav user menu.
 *
 * Toggling a lab is deliberately not covered here: with an empty registry there
 * is nothing to toggle. When the first lab lands, add a `setLab(id, enabled)`
 * helper alongside `labSwitch` and assert the choice survives a reload — that is
 * the test worth having. See agent_docs/labs.md.
 */
import { expect, Locator, Page } from '@playwright/test';

export class LabsModalComponent {
  readonly page: Page;
  private readonly userMenuTrigger: Locator;
  private readonly menuItem: Locator;
  private readonly modal: Locator;
  private readonly content: Locator;
  private readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.userMenuTrigger = page.locator('[data-testid="user-menu-trigger"]');
    this.menuItem = page.locator('[data-testid="hyperdx-labs-menu-item"]');
    this.modal = page.locator('[data-testid="labs-modal"]');
    this.content = page.locator('[data-testid="labs-modal-content"]');
    this.emptyState = page.locator('[data-testid="labs-empty-state"]');
  }

  /**
   * The modal root. Always present in the DOM with zero dimensions, so assert
   * `toBeHidden()` on this for closed state and use {@link content} for open.
   */
  get container() {
    return this.modal;
  }

  /** The modal body — this is what actually reads as visible when open. */
  get body() {
    return this.content;
  }

  /** The user-menu entry that opens this modal. */
  get trigger() {
    return this.menuItem;
  }

  /** Opens the nav user menu and waits for the Labs entry to be clickable. */
  async openUserMenu() {
    await this.userMenuTrigger.scrollIntoViewIfNeeded();
    await this.userMenuTrigger.waitFor({ state: 'attached' });
    await this.userMenuTrigger.click({ timeout: 10000 });
    await expect(this.menuItem).toBeVisible();
  }

  /** Opens the modal from the nav user menu. */
  async open() {
    await this.openUserMenu();
    await this.menuItem.click();
    await expect(this.content).toBeVisible();
  }

  /**
   * A lab's checkbox input — use for state assertions (`toBeChecked()`).
   * Mantine hides it behind an aria-hidden track, so it is not clickable;
   * use {@link setLab} to change it.
   */
  labSwitch(labId: string) {
    return this.page.locator(`[data-testid="lab-switch-${labId}"]`);
  }

  /** Toggles a lab and waits for the write to be persisted. */
  async setLab(labId: string, enabled: boolean) {
    const input = this.labSwitch(labId);
    if ((await input.isChecked()) === enabled) {
      return;
    }

    const persisted = this.page.waitForResponse(
      r => r.url().includes('/me/labs') && r.request().method() === 'PATCH',
    );
    // The label, not the input: the input is visually hidden.
    await this.page.locator(`[data-testid="lab-toggle-${labId}"]`).click();
    const response = await persisted;
    expect(response.status()).toBe(200);
    await expect(input).toBeChecked({ checked: enabled });
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible();
  }
}
