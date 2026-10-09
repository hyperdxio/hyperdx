import { expect, test } from '../../fixtures/netflow';

test.use({ viewport: { width: 1600, height: 1050 } });

test('NetFlow searches, drafts, click filters and sampled details survive reload', async ({
  page,
  netflow,
}) => {
  await page.goto(`/netflow?source=${netflow.source.id}`);
  const records = page.getByTestId('netflow-records');
  const pills = page.getByTestId('netflow-filter-pills');
  const search = page.getByTestId('netflow-search');
  const protocol = page.getByLabel('Protocol', { exact: true });
  await expect(records.locator('tbody tr')).toHaveCount(500);
  await search.fill('Proto:17');
  await protocol.fill('17');
  await page
    .getByTestId('netflow-breakdown-protocol')
    .getByRole('button', { name: 'Filter Protocol: TCP', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Include', exact: true }).click();
  await expect(pills).toContainText('Protocol = TCP');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('where') || '')
    .toBe('');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('protocol') || '')
    .toBe('');
  await expect(search).toHaveValue('Proto:17');
  await expect(protocol).toHaveValue('17');
  await expect(
    records.getByRole('button', { name: 'Filter Protocol: UDP', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(records.getByText('No flow records found')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('where'))
    .toBe('Proto:17');
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await search.fill('Proto:6 AND DstPort:443');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(records.locator('tbody tr')).toHaveCount(500);
  await page.reload();
  await expect(search).toHaveValue('Proto:6 AND DstPort:443');
  await expect(
    records.getByRole('button', { name: 'Filter Protocol: UDP', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Source IP', { exact: true }).fill('192.0.2.2');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(records.locator('tbody tr')).toHaveCount(300);
  await page
    .getByRole('button', { name: 'Inspect flow 1', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Flow details' });
  const field = async (label: string) =>
    Number(
      await drawer
        .getByRole('row')
        .filter({
          has: page.getByRole('rowheader', { name: label, exact: true }),
        })
        .getByRole('cell')
        .innerText(),
    );
  expect(await field('Bytes')).toBe(
    (await field('Raw bytes')) * (await field('Sampling rate')),
  );
  expect(await field('Packets')).toBe(
    (await field('Raw packets')) * (await field('Sampling rate')),
  );
  await drawer
    .getByRole('button', { name: 'Filter Exporter: edge-a', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Exclude', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(records.getByText('No flow records found')).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(records.locator('tbody tr')).toHaveCount(500);
});

test('NetFlow source selection applies immediately and clears incompatible filters', async ({
  page,
  netflow,
}) => {
  await page.goto(`/netflow?source=${netflow.source.id}`);
  const records = page.getByTestId('netflow-records');
  await expect(records.locator('tbody tr')).toHaveCount(500);
  await records
    .getByRole('button', { name: 'Filter Protocol: TCP', exact: true })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Include', exact: true }).click();
  const pills = page.getByTestId('netflow-filter-pills');
  await expect(pills).toContainText('Protocol = TCP');
  await page
    .getByRole('combobox', { name: 'NetFlow source', exact: true })
    .click();
  await page
    .getByRole('option', { name: netflow.alternative.name, exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('source'))
    .toBe(netflow.alternative.id);
  await expect(
    pills.getByRole('button', { name: 'Remove filter' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Source actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Edit source', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').locator('input[name=name]'),
  ).toHaveValue(netflow.alternative.name);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'NetFlow source', exact: true }),
  ).toHaveValue(netflow.alternative.name);
  await expect(records.locator('tbody tr')).toHaveCount(500);
  await page.goto('/netflow?source=missing-source');
  await expect(page.getByText('NetFlow source unavailable')).toBeVisible();
});

test('NetFlow invalid time ranges recover and historical ranges remain empty', async ({
  page,
  netflow,
}) => {
  for (const [from, to] of [
    [1000, 1000],
    [2000, 1000],
  ]) {
    await page.goto(
      `/netflow?source=${netflow.source.id}&from=${from}&to=${to}`,
    );
    await expect(
      page.getByText('Invalid time range', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('netflow-records')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Use past hour', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Inspect flow 1', exact: true }),
    ).toBeVisible();
  }
  await page.goto(`/netflow?source=${netflow.source.id}&from=1000&to=3601000`);
  await expect(
    page.getByTestId('netflow-records').getByText('No flow records found'),
  ).toBeVisible();
});

for (const [key, label] of [
  ['srcAddr', 'Source IP'],
  ['dstAddr', 'Destination IP'],
  ['exporter', 'Exporter'],
  ['protocol', 'Protocol'],
]) {
  test(`NetFlow ${label} include/exclude filters persist and remove`, async ({
    page,
    netflow,
  }) => {
    await page.goto(`/netflow?source=${netflow.source.id}`);
    const records = page.getByTestId('netflow-records');
    await expect(records.locator('tbody tr')).toHaveCount(500);
    const button = page
      .getByTestId(`netflow-breakdown-${key}`)
      .getByRole('button', { name: new RegExp(`^Filter ${label}:`) })
      .first();
    const value = await button.innerText();
    await button.click();
    await page.getByRole('menuitem', { name: 'Include', exact: true }).click();
    const matching = records.getByRole('button', {
      name: `Filter ${label}: ${value}`,
      exact: true,
    });
    await expect
      .poll(
        async () =>
          (await matching.count()) > 0 &&
          (await matching.count()) ===
            (await records.locator('tbody tr').count()),
      )
      .toBe(true);
    await page.reload();
    await expect(matching.first()).toBeVisible();
    await page
      .getByTestId('netflow-filter-pills')
      .getByRole('button', { name: 'Remove filter' })
      .click();
    await expect(records.locator('tbody tr')).toHaveCount(500);
    await button.click();
    await page.getByRole('menuitem', { name: 'Exclude', exact: true }).click();
    await expect(matching).toHaveCount(0);
  });
}
