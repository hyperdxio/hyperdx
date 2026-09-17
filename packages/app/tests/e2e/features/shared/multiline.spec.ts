import type { Page } from '@playwright/test';

import {
  QueryLanguage,
  WhereInputComponent,
} from '../../components/WhereInputComponent';
import { DashboardsListPage } from '../../page-objects/DashboardsListPage';
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { expectExpandsAndStaysExpanded } from '../../utils/multiline-input';

test.describe('Multiline Input', { tag: '@search' }, () => {
  /** Pages that render a WHERE input, and how to get to one. */
  const pages = [
    {
      name: 'Search Page',
      openWhereInput: async (page: Page) => {
        const searchPage = new SearchPage(page);
        await searchPage.goto();
        return searchPage.whereInput;
      },
    },
    {
      name: 'Dashboard Page',
      openWhereInput: async (page: Page) => {
        const dashboardsListPage = new DashboardsListPage(page);
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        return new WhereInputComponent(page);
      },
    },
  ];

  const languages: QueryLanguage[] = ['SQL', 'Lucene'];

  pages.forEach(({ name, openWhereInput }) => {
    languages.forEach(language => {
      test(`should expand ${language} input on line break on ${name}`, async ({
        page,
      }) => {
        const whereInput = await openWhereInput(page);
        await whereInput.selectLanguage(language);

        const field = whereInput.field(language);
        await expect(field.focusTarget).toBeVisible();

        await expectExpandsAndStaysExpanded(page, field, {
          onSingleLine: () => whereInput.expectSeamFlush(),
        });
      });
    });
  });

  test('should keep SELECT and ORDER BY expanded after blur', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();

    for (const field of [
      searchPage.selectClauseField(),
      searchPage.orderByClauseField(),
    ]) {
      await expect(field.focusTarget).toBeVisible();
      await searchPage.clearClause(field);
      await expectExpandsAndStaysExpanded(page, field);
    }
  });
});
