import { Page } from '@playwright/test';

export const getSqlEditor = (page: Page, placeholder?: string) => {
  const locator = placeholder
    ? `div.cm-editor:has-text("${placeholder}")`
    : 'div.cm-editor';
  return page.locator(locator).first();
};

/**
 * Dismiss the CodeMirror autocomplete dropdown by blurring the focused editor.
 *
 * Do NOT use `keyboard.press('Escape')` for this: Mantine's Modal registers a
 * window-level, capture-phase `keydown` listener for closeOnEscape (default
 * true) that fires before CodeMirror can consume the key and ignores
 * `preventDefault`. So any Escape typed into a SQL editor inside a modal (e.g.
 * the dashboard tile editor) closes the whole modal, hanging the flow. Blurring
 * the active element closes the completion via CodeMirror's `closeOnBlur`
 * (default) and dispatches no key event, so the surrounding modal is untouched.
 * Then wait for the tooltip to actually disappear so a following click isn't
 * intercepted by a still-animating popup.
 */
export const dismissSqlAutocomplete = async (page: Page) => {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await page
    .locator('.cm-tooltip-autocomplete')
    .waitFor({ state: 'hidden', timeout: 2000 })
    .catch(() => {
      // Nothing was open (or it closed already) — either way it's gone.
    });
};
