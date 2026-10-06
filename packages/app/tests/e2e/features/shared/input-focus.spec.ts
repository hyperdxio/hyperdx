import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

/**
 * The query fields mark focus by recoloring their border. The Paper theme sets
 * that border inline, which outranks any stylesheet rule, so these assertions
 * read the color that actually lands on the element rather than trusting the
 * class that asks for it.
 */
test.describe('Query input focus states', { tag: '@search' }, () => {
  const languages = [
    { name: 'Lucene', select: (p: SearchPage) => p.switchToLuceneMode() },
    { name: 'SQL', select: (p: SearchPage) => p.switchToSQLMode() },
  ];

  test('marks the WHERE input as focused in both languages', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();

    for (const language of languages) {
      await language.select(searchPage);

      const blurred = await searchPage.getWhereBorderColors();
      expect(blurred.input).not.toBe('');

      await searchPage.focusWhereInput();

      // Both halves take the focus color, so the control doesn't read as
      // half-focused.
      await expect
        .poll(async () => (await searchPage.getWhereBorderColors()).input)
        .not.toBe(blurred.input);
      const focused = await searchPage.getWhereBorderColors();
      expect(focused.languageSwitch).toBe(focused.input);
    }
  });

  test('marks SELECT and ORDER BY as focused', async ({ page }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();

    const selectBlurred = await searchPage.getSelectBorderColor();
    await searchPage.getSELECTEditor().focus();
    await expect
      .poll(() => searchPage.getSelectBorderColor())
      .not.toBe(selectBlurred);

    const orderByBlurred = await searchPage.getOrderByBorderColor();
    await searchPage.getOrderByEditor().focus();
    await expect
      .poll(() => searchPage.getOrderByBorderColor())
      .not.toBe(orderByBlurred);
  });
});
