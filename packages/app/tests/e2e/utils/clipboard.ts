import { expect, Page } from '@playwright/test';

/**
 * Clear the clipboard, run `trigger` (which copies), then wait for the
 * clipboard to be populated and return its contents.
 *
 * Use this when the copy action has no reliable visible success signal (e.g.
 * the row side panel's Share icon just swaps to a check). Requires the context
 * to have 'clipboard-read'/'clipboard-write' permissions.
 */
export async function readCopiedLink(
  page: Page,
  trigger: () => Promise<void>,
): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await trigger();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
      timeout: 10_000,
    })
    .not.toBe('');
  return page.evaluate(() => navigator.clipboard.readText());
}
