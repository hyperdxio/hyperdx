import { NETFLOW_SUMMARY_TILES } from '../../../../src/netflow';
import { formatNumber } from '../../../../src/utils';
import { expect, test } from '../../fixtures/netflow';

test('four NetFlow overview tiles share one summary query and show distinct metrics', async ({
  page,
  netflow,
}) => {
  const requests: string[] = [];
  page.on('request', request => {
    const sql = request.postData() || '';
    if (request.method() === 'POST' && sql.includes('__netflow_bitsPerSecond'))
      requests.push(sql);
  });
  const [start, end] = netflow.dateRange;
  await page.goto(
    `/netflow?source=${netflow.source.id}&from=${start.getTime()}&to=${end.getTime()}`,
  );
  const bytes =
    300 * (1000000 * 100 + 1000000000 + 1000000000 * 100 + 1000000000);
  const packets = 600 * 1000 * 100 + 600 * 1000;
  const expected = [(bytes * 8) / 3600, packets / 3600, bytes, 1200];
  await expect(page.getByTestId('number-chart-value')).toHaveText(
    expected.map((value, index) =>
      formatNumber(value, NETFLOW_SUMMARY_TILES[index].numberFormat),
    ),
  );
  expect(requests).toHaveLength(1);
});
