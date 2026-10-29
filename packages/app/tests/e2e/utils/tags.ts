import { expect, Locator, Page } from '@playwright/test';

/**
 * Drive the shared Tags popover (components/Tags.tsx) from its trigger button.
 * The dropdown is portalled, so its search input is looked up on the page.
 * Closing goes through the trigger rather than Escape, which would bubble to
 * an enclosing modal and close that too.
 */
async function withTagPicker(
  page: Page,
  trigger: Locator,
  fn: (search: Locator) => Promise<void>,
) {
  await trigger.click();
  const search = page.getByPlaceholder(/Search (or create )?tag/);
  await search.waitFor({ state: 'visible' });
  await fn(search);
  await trigger.click();
  await search.waitFor({ state: 'detached' });
}

/** Type a new tag and press Enter to create and select it. */
export async function addTagViaPicker(
  page: Page,
  trigger: Locator,
  tag: string,
) {
  await withTagPicker(page, trigger, async search => {
    await search.fill(tag);
    await search.press('Enter');
  });
}

/**
 * Deselect a tag. Labels render uppercased. Plain click rather than
 * `uncheck()`: a tag known only to this picker leaves the list the moment it
 * is deselected, and `uncheck()` never gets to confirm the new state.
 */
export async function removeTagViaPicker(
  page: Page,
  trigger: Locator,
  tag: string,
) {
  await withTagPicker(page, trigger, async search => {
    await search.fill(tag);
    const name = tag.toUpperCase();
    await page.getByRole('checkbox', { name }).click();
    await expect(
      page.getByRole('checkbox', { name, checked: true }),
    ).toHaveCount(0);
  });
}
