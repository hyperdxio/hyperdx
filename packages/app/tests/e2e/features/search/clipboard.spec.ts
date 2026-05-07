/**
 * Verifies the clipboard fallback (`packages/app/src/utils/clipboard.ts`)
 * across the six call sites that previously called `navigator.clipboard.writeText`
 * directly. See https://github.com/hyperdxio/hyperdx/issues/2135.
 *
 * Tests are hook-based: an init script wires `navigator.clipboard.writeText`
 * and `document.execCommand('copy')` to a shared `window.__copyHistory` array
 * so we can assert which path each call site actually took without depending
 * on Chromium clipboard permissions or polluted state from previous tests.
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

const HOOK_INIT_SCRIPT = (mode: 'modern' | 'no-modern' | 'fail-both') => {
  return () => {
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

    // Modern API installation depends on mode
    if (mode === 'modern') {
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
      // Simulate non-secure context: navigator.clipboard is undefined
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
      if (mode === 'fail-both') {
        window.__forceExecCommandFalse = true;
      }
    }
  };
};

async function installCopyHook(
  page: Page,
  mode: 'modern' | 'no-modern' | 'fail-both' = 'modern',
) {
  await page.addInitScript(HOOK_INIT_SCRIPT(mode));
}

async function getCopyHistory(page: Page): Promise<CopyEntry[]> {
  return await page.evaluate(() => window.__copyHistory ?? []);
}

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

test.describe('Clipboard fallback', { tag: ['@search'] }, () => {
  test('row JSON button copies via the modern API and shows a success toast', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    // The rowButtons container is opacity-0 until the row is hovered.
    await searchPage.table.firstRow.hover();
    const copyJsonButton = searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-copy')
      .first();
    await copyJsonButton.click();

    await expect(page.getByText('Copied row as JSON')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('modern');
    // Should be a JSON object string (parses cleanly).
    expect(() => JSON.parse(history[0].text)).not.toThrow();
  });

  test('row URL button copies a shareable link with rowWhere and rowSource params', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    const copyLinkButton = searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-link')
      .first();
    await copyLinkButton.click();

    await expect(page.getByText('Copied shareable link')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('modern');
    expect(history[0].text).toContain('rowWhere=');
  });

  test('parsed-tab "Copy row as JSON" icon copies via the modern API', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    // HyperJsonMenu renders the row-level copy button with a `Copy row as JSON`
    // tooltip and the Tabler IconCopy SVG.
    const sidePanelCopy = page
      .getByTitle('Copy row as JSON')
      .or(page.locator('[title="Copy row as JSON"]'))
      .first();
    // Fallback locator: the IconCopy inside the side panel's HyperJsonMenu group.
    const sideCopyByIcon = searchPage.sidePanel.container
      .locator('.tabler-icon-copy')
      .first();
    if (await sidePanelCopy.isVisible().catch(() => false)) {
      await sidePanelCopy.click();
    } else {
      await sideCopyByIcon.click();
    }

    await expect(
      page.getByText('Value copied to clipboard').first(),
    ).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[history.length - 1].source).toBe('modern');
  });

  test('parsed-tab line action "Copy Value" copies via the modern API', async ({
    page,
  }) => {
    await installCopyHook(page, 'modern');
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    // Hover a string leaf so the line menu mounts (HyperJson only mounts
    // LineMenu when hovered).
    const stringEl = page.locator('[class*="string"]').first();
    await expect(stringEl).toBeVisible();
    await stringEl.hover();

    const copyValueButton = page
      .getByRole('button', { name: /Copy Value/ })
      .first();
    await copyValueButton.click();

    await expect(
      page.getByText('Value copied to clipboard').first(),
    ).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[history.length - 1].source).toBe('modern');
  });

  test('row JSON button falls back to execCommand when the modern API is unavailable', async ({
    page,
  }) => {
    await installCopyHook(page, 'no-modern');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    const copyJsonButton = searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-copy')
      .first();
    await copyJsonButton.click();

    await expect(page.getByText('Copied row as JSON')).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('fallback');
    expect(() => JSON.parse(history[0].text)).not.toThrow();
  });

  test('row JSON button shows the failure toast when both paths fail', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', err => consoleErrors.push(err.message));

    await installCopyHook(page, 'fail-both');
    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    const copyJsonButton = searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-copy')
      .first();
    await copyJsonButton.click();

    await expect(
      page.getByText(
        "Couldn't copy. HyperDX needs HTTPS or localhost to use the browser clipboard API.",
      ),
    ).toBeVisible();

    const history = await getCopyHistory(page);
    expect(history).toHaveLength(0);
    expect(consoleErrors).toEqual([]);
  });

  test('success toast renders correctly in light theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mantine-color-scheme-value', 'light');
    });
    await installCopyHook(page, 'modern');

    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    await searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-copy')
      .first()
      .click();

    const toast = page.getByText('Copied row as JSON');
    await expect(toast).toBeVisible();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'light');
  });

  test('success toast renders correctly in dark theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mantine-color-scheme-value', 'dark');
    });
    await installCopyHook(page, 'modern');

    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    await searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-copy')
      .first()
      .click();

    const toast = page.getByText('Copied row as JSON');
    await expect(toast).toBeVisible();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'dark');
  });

  test('failure toast renders correctly in dark theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mantine-color-scheme-value', 'dark');
    });
    await installCopyHook(page, 'fail-both');

    const searchPage = new SearchPage(page);
    await openSearchAndFirstRow(searchPage);

    await searchPage.table.firstRow.hover();
    await searchPage.table.firstRow
      .locator('[class*="rowButtons"] .tabler-icon-copy')
      .first()
      .click();

    const failureToast = page.getByText(
      "Couldn't copy. HyperDX needs HTTPS or localhost to use the browser clipboard API.",
    );
    await expect(failureToast).toBeVisible();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'dark');
  });
});
