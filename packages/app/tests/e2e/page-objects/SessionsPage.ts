/**
 * SessionsPage - Page object for the /sessions page
 * Encapsulates all interactions with the sessions (session replay) interface
 */
import { Locator, Page } from '@playwright/test';

import { DEFAULT_SESSIONS_SOURCE_NAME } from '../utils/constants';

export class SessionsPage {
  readonly page: Page;
  private readonly searchForm: Locator;
  private readonly dataSourceInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchForm = page.locator('[data-testid="sessions-search-form"]');
    this.dataSourceInput = page.locator('input[placeholder="Data Source"]');
  }

  /**
   * Navigate to the sessions page
   */
  async goto() {
    await this.page.goto('/sessions');
  }

  async selectDataSource(
    dataSourceName: string = DEFAULT_SESSIONS_SOURCE_NAME,
  ) {
    await this.dataSourceInput.click();
    const dataSourceOption = this.page.locator(`text=${dataSourceName}`);
    await dataSourceOption.click();
  }

  /**
   * Get all session cards
   */
  getSessionCards() {
    return this.page.locator('[data-testid^="session-card-"]');
  }

  /**
   * Get a specific session card by index
   */
  getSessionCard(index: number) {
    return this.getSessionCards().nth(index);
  }

  /**
   * Get the first session card
   */
  getFirstSessionCard() {
    return this.getSessionCards().first();
  }

  /**
   * Click on a session card to open session replay
   */
  async openSession(index: number = 0) {
    const sessionCard = this.getSessionCard(index);
    await sessionCard.click();
  }

  /**
   * Click on first session card
   */
  async openFirstSession() {
    await this.getFirstSessionCard().click();
  }

  // Getters for assertions

  get form() {
    return this.searchForm;
  }

  get dataSource() {
    return this.dataSourceInput;
  }
}
