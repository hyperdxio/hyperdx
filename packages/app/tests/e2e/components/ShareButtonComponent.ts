/**
 * ShareButtonComponent - the "Share" button (data-testid="share-link-button")
 * rendered on the search page, Chart Explorer and dashboards. Clicking it
 * copies a shareable link to the clipboard — a compressed `?share=` token when
 * the view state is large, or a plain URL when it is small.
 *
 * Reading the clipboard requires the browser context to have been granted
 * 'clipboard-read'/'clipboard-write' permissions (see share.spec.ts's
 * `test.use({ permissions: [...] })`).
 */
import { expect, Locator, Page } from '@playwright/test';

export class ShareButtonComponent {
  readonly page: Page;
  private readonly button: Locator;
  private readonly successToast: Locator;

  constructor(page: Page, testId: string = 'share-link-button') {
    this.page = page;
    this.button = page.getByTestId(testId);
    this.successToast = page.getByText('Copied shareable link to clipboard');
  }

  get shareButton() {
    return this.button;
  }

  /**
   * Click the Share button and wait for the success toast, confirming the copy
   * completed.
   */
  async copyLink() {
    await this.button.click();
    await expect(this.successToast).toBeVisible();
  }

  /**
   * Click Share and return the URL that was copied to the clipboard.
   */
  async copyAndReadLink(): Promise<string> {
    await this.copyLink();
    return this.page.evaluate(() => navigator.clipboard.readText());
  }
}
