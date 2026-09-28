import { Locator, Page } from '@playwright/test';

/**
 * Replace everything in a CodeMirror editor, given its `.cm-content` node.
 *
 * Select-all then Delete rather than `fill()`: CodeMirror's content node is
 * contenteditable, not an input, so the editor only sees text that arrives as
 * key events.
 */
export const replaceEditorText = async (
  page: Page,
  content: Locator,
  text: string,
) => {
  await content.click();
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
  );
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
};

export const getSqlEditor = (page: Page, placeholder?: string) => {
  const locator = placeholder
    ? `div.cm-editor:has-text("${placeholder}")`
    : 'div.cm-editor';
  return page.locator(locator).first();
};

/**
 * The bordered box around a query editor: the nearest Mantine Paper ancestor,
 * which is what the user sees grow when the query wraps. Takes any node inside
 * it — the editor itself, or the clause label beside it.
 */
export const borderedBox = (inner: Locator) =>
  inner.locator(
    'xpath=ancestor::div[contains(@class, "mantine-Paper-root")][1]',
  );

/**
 * Move focus off whatever holds it, without pressing a key.
 *
 * Keyboard-driven blurs are not interchangeable here: Escape inside a Mantine
 * Modal closes the modal (see `dismissSqlAutocomplete`), and Tab moves focus to
 * a neighbour that may itself change the layout under test.
 */
export const blurActiveElement = async (page: Page) => {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
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
  await blurActiveElement(page);
  await page
    .locator('.cm-tooltip-autocomplete')
    .waitFor({ state: 'hidden', timeout: 2000 })
    .catch(() => {
      // Nothing was open (or it closed already) — either way it's gone.
    });
};
