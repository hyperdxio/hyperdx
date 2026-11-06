import { expect, test } from '../../fixtures/netflow';

test('creates an inferred NetFlow source and opens its records in shared Search', async ({
  page,
  netflow,
}) => {
  await page.goto(`/netflow?source=${netflow.source.id}`);
  await expect(
    page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
  ).toBeVisible();
  const search = page.getByTestId('netflow-search');
  await search.fill('DstPo');
  await expect(
    page
      .getByTestId('autocomplete-suggestion')
      .filter({ hasText: 'DstPort (number)' }),
  ).toBeVisible();
  await search.press('Escape');
  await page
    .getByRole('button', { name: 'Source actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Create new source', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Add NetFlow source' });
  const name = `${netflow.database} created`;
  await form.locator('input[name=name]').fill(name);
  await form
    .getByPlaceholder('Database', { exact: true })
    .fill(netflow.database);
  await page
    .getByRole('option', { name: netflow.database, exact: true })
    .click();
  await form.getByPlaceholder('Table', { exact: true }).fill('flows');
  await page.getByRole('option', { name: 'flows', exact: true }).click();
  await expect(form.locator('.cm-content').first()).toHaveText('TimeReceived');
  await form
    .getByRole('button', { name: 'Save New Source', exact: true })
    .click();
  await expect(form).toBeHidden();
  await expect(
    page.getByRole('combobox', { name: 'NetFlow source', exact: true }),
  ).toHaveValue(name);
  await expect(
    page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(
    page
      .getByRole('cell')
      .filter({ hasText: /192\.0\.2/ })
      .first(),
  ).toBeVisible();
});
