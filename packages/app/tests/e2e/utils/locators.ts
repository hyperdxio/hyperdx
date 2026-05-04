import { Page } from '@playwright/test';

export const getSqlEditor = (page: Page, placeholder?: string) => {
  const locator = placeholder
    ? `div.cm-editor:has-text("${placeholder}")`
    : 'div.cm-editor';
  return page.locator(locator).first();
};
