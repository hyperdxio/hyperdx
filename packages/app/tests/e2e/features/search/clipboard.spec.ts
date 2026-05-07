/**
 * Verifies the clipboard fallback (`packages/app/src/utils/clipboard.ts`)
 * across the six call sites that previously called `navigator.clipboard.writeText`
 * directly. See https://github.com/hyperdxio/hyperdx/issues/2135.
 *
 * Tests are hook-based: an init script wires `navigator.clipboard.writeText`
 * and `document.execCommand('copy')` to a shared `window.__copyHistory` array
 * so we can assert which path each call site actually took without depending
 * on Chromium clipboard permissions or polluted state from previous tests.
 *
 * One test (`row JSON button writes through to the real OS clipboard via the
 * fallback`) does NOT install the hook so it exercises the real
 * `document.execCommand('copy')` path end-to-end and reads the result via
 * `navigator.clipboard.readText()`. That keeps us honest: the hook only
 * confirms code-path routing, not that the OS clipboard actually receives
 * the text.
 */
import { Page } from '@playwright/test';

import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

type CopyEntry = { source: 'modern' | 'fallback'; text: string };

declare global {
  interface Window {
    __copyHistory: CopyEntry[];
    __forceModernThrow: boolean;
    __forceExecCommandFalse: boolean;
  }
}

// Note: addInitScript serialises the function via .toString(), which strips
// closure variables. Pass `mode` as the Playwright arg parameter so it is
// properly serialised and available inside the page.
async function installCopyHook(
  page: Page,
  mode: 'modern' | 'no-modern' | 'fail-both' = 'modern',
) {
  await page.addInitScript((m: string) => {
    window.__copyHistory = [];
    window.__forceModernThrow = false;
    window.__forceExecCommandFalse = false;

    const realExec = document.execCommand.bind(document);
    document.execCommand = function (cmd: string, ...rest: any[]): boolean {
      if (cmd === 'copy') {
        const ta = document.activeElement as HTMLTextAreaElement | null;
        const text = ta && 'value' in ta ? ta.value : '';
        if (window.__forceExecCommandFalse) {
          return false;
        }
        window.__copyHistory.push({ source: 'fallback', text });
        return true;
      }
      return realExec(cmd, ...(rest as []));
    };

    if (m === 'modern') {
      Object.defineProperty(window, 'isSecureContext', {
        value: true,
        configurable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            if (window.__forceModernThrow) {
              throw new Error('forced rejection');
            }
            window.__copyHistory.push({ source: 'modern', text });
          },
          readText: async () => {
            const last = window.__copyHistory[window.__copyHistory.length - 1];
            return last ? last.text : '';
          },
        },
        configurable: true,
      });
    } else {
      // Simulate non-secure context end-to-end: both `isSecureContext` and
      // the clipboard API are absent so `copyTextToClipboard` routes
      // straight to the synchronous execCommand fallback.
      Object.defineProperty(window, 'isSecureContext', {
        value: false,
        configurable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
      if (m === 'fail-both') {
        window.__forceExecCommandFalse = true;
      }
    }
  }, mode);
}

async function getCopyHistory(page: Page): Promise<CopyEntry[]> {
  return await page.evaluate(() => window.__copyHistory ?? []);
}

const FAILURE_TOAST =
  "Couldn't copy to clipboard. If you're on plain HTTP, switch to HTTPS or localhost.";

async function openSearchAndFirstRow(searchPage: SearchPage) {
  await searchPage.goto();
  await searchPage.submitEmptySearch();
  await expect(searchPage.table.firstRow).toBeVisible({ timeout: 10000 });
}

async function openParsedTab(searchPage: SearchPage) {
  await openSearchAndFirstRow(searchPage);
  await searchPage.table.clickFirstRow();
  await searchPage.sidePanel.clickTab('parsed');
}

async function hoverFirstRowAndClickCopyJson(searchPage: SearchPage) {
  await searchPage.table.firstRow.hover();
  await searchPage.table.firstRow.getByTestId('row-copy-json-button').click();
}

test.describe('Clipboard fallback', { tag: ['@search'] }, () => {
  test('row JSON button copies via the modern API and shows a success toast', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await hoverFirstRowAndClickCopyJson(searchPage);

    await expect(page.getByText('Copied row as JSON')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('modern');
    expect(() => JSON.parse(history[0].text)).not.toThrow();
  });

  test('row URL button copies a shareable link with rowWhere and rowSource params', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    await searchPage.table.firstRow.getByTestId('row-copy-link-button').click();

    await expect(page.getByText('Copied shareable link')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('modern');
    expect(history[0].text).toContain('rowWhere=');
  });

  test('row URL button falls back to execCommand when the modern API is unavailable', async ({
    page,
  }) => {
    await installCopyHook(page, 'no-modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    await searchPage.table.firstRow.getByTestId('row-copy-link-button').click();

    await expect(page.getByText('Copied shareable link')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('fallback');
    expect(history[0].text).toContain('rowWhere=');
  });

  test('field-value popover copy button uses the modern API and shows a success toast', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    // Hover a cell to open the field popover; click the copy button by testid.
    const firstCell = searchPage.table.firstRow.locator('td').nth(1);
    await firstCell.hover();
    const copyFieldButton = page.getByTestId('field-copy-value-button');
    await expect(copyFieldButton).toBeVisible();
    await copyFieldButton.click();

    await expect(page.getByText('Copied field value')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('modern');
  });

  test('parsed-tab "Copy row as JSON" icon copies via the modern API', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    await page.getByTestId('json-viewer-copy-row').click();

    await expect(
      page.getByText('Value copied to clipboard').first(),
    ).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const last = history[history.length - 1];
    expect(last.source).toBe('modern');
    // Should be a JSON object string (parses cleanly).
    expect(() => JSON.parse(last.text)).not.toThrow();
  });

  test('parsed-tab line action "Copy Value" copies via the modern API', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    const stringEl = page.getByTestId('hyperjson-value-string').first();
    await expect(stringEl).toBeVisible();
    await stringEl.hover();

    await page
      .getByRole('button', { name: /Copy Value/ })
      .first()
      .click();

    await expect(
      page.getByText('Value copied to clipboard').first(),
    ).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[history.length - 1].source).toBe('modern');
  });

  test('parsed-tab line action "Copy Object" copies a nested object as JSON', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    const objectEl = page.getByTestId('hyperjson-value-object').first();
    await expect(objectEl).toBeVisible();
    await objectEl.hover();

    await page
      .getByRole('button', { name: /Copy Object/ })
      .first()
      .click();

    await expect(
      page.getByText('Copied object to clipboard').first(),
    ).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const last = history[history.length - 1];
    expect(last.source).toBe('modern');
    // Copy Object always serialises a JSON object; assert it parses.
    const parsed = JSON.parse(last.text);
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  test('row JSON button falls back to execCommand when the modern API is unavailable', async ({
    page,
  }) => {
    await installCopyHook(page, 'no-modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await hoverFirstRowAndClickCopyJson(searchPage);

    await expect(page.getByText('Copied row as JSON')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('fallback');
    expect(() => JSON.parse(history[0].text)).not.toThrow();
  });

  test('row JSON button writes through to the real OS clipboard via the fallback', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Clipboard read permission flow tested only on chromium',
    );

    // Force the fallback path WITHOUT installing the hook. The browser's
    // real document.execCommand('copy') should land the text on the OS
    // clipboard, which we then read via navigator.clipboard.readText.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isSecureContext', {
        value: false,
        configurable: true,
      });
    });
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);

    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await hoverFirstRowAndClickCopyJson(searchPage);

    await expect(page.getByText('Copied row as JSON')).toBeVisible();

    // Re-grant clipboard permissions and read what landed on the OS clipboard.
    const onClipboard = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return '';
      }
    });
    expect(onClipboard.length).toBeGreaterThan(0);
    expect(() => JSON.parse(onClipboard)).not.toThrow();
  });

  test('row JSON button shows the failure toast when both paths fail and keeps isCopied false', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', err => consoleErrors.push(err.message));

    await installCopyHook(page, 'fail-both');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await hoverFirstRowAndClickCopyJson(searchPage);

    await expect(page.getByText(FAILURE_TOAST)).toBeVisible();

    // Regression test for the `if (ok) setIsCopied(true)` guard: the icon's
    // tooltip must NOT switch to "Copied entire row as JSON!" on a failed
    // copy. The Mantine Tooltip exposes the title via the wrapped div.
    const copyJsonButton = searchPage.table.firstRow.getByTestId(
      'row-copy-json-button',
    );
    await expect(copyJsonButton).toBeVisible();
    // The inner Tooltip target wraps the data-testid'd div. Inspect the
    // sibling Tooltip-rendered label after hovering to surface the current
    // tooltip text.
    await copyJsonButton.hover();
    await expect(
      page.getByText('Copy entire row as JSON', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Copied entire row as JSON!', { exact: true }),
    ).toBeHidden();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(0);
    expect(consoleErrors).toEqual([]);
  });

  test('field-value popover shows the failure toast when both paths fail', async ({
    page,
  }) => {
    await installCopyHook(page, 'fail-both');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    const firstCell = searchPage.table.firstRow.locator('td').nth(1);
    await firstCell.hover();
    const copyFieldButton = page.getByTestId('field-copy-value-button');
    await expect(copyFieldButton).toBeVisible();
    await copyFieldButton.click();

    await expect(page.getByText(FAILURE_TOAST)).toBeVisible();
  });

  test('parsed-tab "Copy row as JSON" shows the failure toast when both paths fail', async ({
    page,
  }) => {
    await installCopyHook(page, 'fail-both');
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    await page.getByTestId('json-viewer-copy-row').click();

    await expect(page.getByText(FAILURE_TOAST)).toBeVisible();
  });
});
