/**
 * SourcesListPage - Page object for the team "Data" tab (/team), which renders
 * the full list of configured sources and expands an inline TableSourceForm
 * when a source row is toggled.
 *
 * Unlike the search page's source picker, this list includes every source kind
 * (including metric sources), so it's the way to open the edit form for a
 * metric source.
 */
import { Locator, Page } from '@playwright/test';

export class SourcesListPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/team');
  }

  /**
   * The row for a source, matched by its (unique) display name. Each row is
   * rendered with an `id="source-<id>"` anchor.
   */
  sourceRow(name: string): Locator {
    return this.page.locator('[id^="source-"]').filter({ hasText: name });
  }

  /**
   * Expand a source's inline edit form by clicking its chevron toggle.
   */
  async expandSource(name: string): Promise<void> {
    await this.sourceRow(name).getByRole('button').first().click();
  }
}
