/**
 * SavedSearchModalComponent - Reusable component for save search modal
 * Used for creating and managing saved searches
 * Not used until Saved Search functionality is implemented
 */
import { expect, Locator, Page } from '@playwright/test';

export class SavedSearchModalComponent {
  readonly page: Page;
  private readonly modal: Locator;
  private readonly nameInput: Locator;
  private readonly submitButton: Locator;
  private readonly addTagButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.locator('[data-testid="save-search-modal"]');
    this.nameInput = page.locator('[data-testid="save-search-name-input"]');
    this.submitButton = page.locator(
      '[data-testid="save-search-submit-button"]',
    );
    this.addTagButton = page.locator('[data-testid="add-tag-button"]');
  }

  /**
   * Get the modal container
   */
  get container() {
    return this.modal;
  }

  /**
   * Fill in the search name
   */
  async fillName(name: string) {
    await this.nameInput.fill(name);
  }

  /**
   * Submit the save search form
   */
  async submit() {
    await this.submitButton.click();
  }

  /**
   * Add a tag to the saved search
   */
  async addTag(tagName: string) {
    await this.addTagButton.click();

    // Wait for tag input/dropdown to appear
    // Note: Implementation may vary based on actual UI
    const tagInput = this.page.locator('input[placeholder*="tag" i]').last();
    await tagInput.fill(tagName);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Complete workflow: fill name and submit
   */
  async saveSearch(name: string, tags: string[] = []) {
    await this.fillName(name);

    for (const tag of tags) {
      await this.addTag(tag);
    }

    await this.submit();
  }

  /**
   * Save search and wait for URL to change to the saved search page
   * This is more reliable than waiting separately for modal close and URL change
   */
  async saveSearchAndWaitForNavigation(
    name: string,
    tags: string[] = [],
  ): Promise<void> {
    await this.fillName(name);

    for (const tag of tags) {
      await this.addTag(tag);
    }

    // Wait for submit button to be enabled (form might need validation time)
    await expect(this.submitButton).toBeEnabled({ timeout: 5000 });

    // Start waiting for URL change BEFORE clicking submit to avoid race condition
    const urlPromise = this.page.waitForURL(/\/search\/[a-f0-9]+/, {
      timeout: 15000,
    });

    await this.submit();

    // Wait for navigation to complete
    await urlPromise;

    // Wait for modal to fully close
    await expect(this.container).toBeHidden();
  }

  /**
   * Get tag elements
   */
  getTags() {
    return this.modal.locator('[data-testid^="tag-"]');
  }

  /**
   * Remove a tag by name
   */
  async removeTag(tagName: string) {
    const tagButton = this.modal.locator(
      `button:has-text("${tagName.toUpperCase()}")`,
    );
    const removeIcon = tagButton.locator('svg');
    await removeIcon.click();
  }
}
