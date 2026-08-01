/**
 * Regression guard for: histogram "X Results" count must reflect the user's
 * exact selected time range, not a granularity-bucket-aligned expansion of it.
 *
 * To get a deterministic assertion we seed our own logs directly into
 * ClickHouse: 10 events spaced 1 s apart on fractional-second offsets, anchored
 * to a 15-second-aligned reference time. A 5-second search range that starts
 * 2 s into the bucket isolates exactly 5 of those events; the buggy
 * bucket-aligned histogram query would see all 10.
 */
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { E2E_CLICKHOUSE_DATABASE, E2E_LOGS_TABLE } from '../../utils/constants';

const CLICKHOUSE_HOST =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';

async function clickhouseQuery(sql: string): Promise<void> {
  const url = new URL(CLICKHOUSE_HOST);
  url.searchParams.set('user', CLICKHOUSE_USER);
  if (CLICKHOUSE_PASSWORD) {
    url.searchParams.set('password', CLICKHOUSE_PASSWORD);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: sql,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ClickHouse query failed (${response.status}): ${errorText}`,
    );
  }
}

/**
 * Insert 10 log rows into e2e_otel_logs at fixed timestamps, all sharing a
 * unique ServiceName so the test can filter to its own data (preventing
 * collisions with other parallel tests or the global seed).
 *
 * Returns the bucket-aligned reference timestamp and the marker service name.
 */
async function seedCountMismatchLogs(): Promise<{
  refMs: number;
  markerService: string;
}> {
  // Unique marker per run; Lucene matches it exactly inside quotes.
  const markerService = `count_mismatch_${Date.now()}_${Math.floor(
    Math.random() * 1_000_000,
  )}`;

  // Anchor 5 minutes in the past (well within the 1h-past seed window) and
  // snap down to a 15-second boundary so a sub-bucket search range will be
  // fully contained in a single granularity bucket.
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const refMs = Math.floor(fiveMinAgo / 15_000) * 15_000;

  // Events at offsets 0.5 s, 1.5 s, ..., 9.5 s. Placing them on the half-second
  // means our 5 s search range [ref+2 s, ref+7 s] contains exactly the five
  // events at offsets 2.5, 3.5, 4.5, 5.5, 6.5 — regardless of whether the
  // range upper bound is treated as inclusive or exclusive.
  const rows: string[] = [];
  for (let i = 0; i < 10; i++) {
    const tsMs = refMs + i * 1000 + 500;
    const tsNs = tsMs * 1_000_000;
    rows.push(
      `('${tsNs}', '', '', 0, 'info', 0, '${markerService}', 'count test ${i}', '', {}, '', '', '', {}, {})`,
    );
  }

  await clickhouseQuery(`
    INSERT INTO ${E2E_CLICKHOUSE_DATABASE}.${E2E_LOGS_TABLE} (
      Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
      ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
      ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
    ) VALUES ${rows.join(',\n')}
  `);

  return { refMs, markerService };
}

function toPickerFormat(tsMs: number): string {
  const d = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

test.describe(
  'Search histogram count matches table for sub-bucket time ranges',
  { tag: ['@full-stack', '@search'] },
  () => {
    test('count is 5 (user range) not 10 (bucket-aligned range)', async ({
      page,
    }) => {
      const { refMs, markerService } = await seedCountMismatchLogs();

      const searchPage = new SearchPage(page);
      await searchPage.goto();
      await expect(searchPage.form).toBeVisible();

      // 5-second range inside the 15-second bucket that contains all 10 events.
      // Expected events in [ref+2 s, ref+7 s]: those at offsets 2.5–6.5 ⇒ 5.
      const startMs = refMs + 2_000;
      const endMs = refMs + 7_000;

      await searchPage.timePicker.open();
      await searchPage.timePicker.disableRelativeTime();
      await searchPage.timePicker.selectRangeMode();
      await searchPage.timePicker.setCustomTimeRange(
        toPickerFormat(startMs),
        toPickerFormat(endMs),
      );

      await searchPage.page.waitForURL(
        u => new URL(u).searchParams.get('from') === String(startMs),
      );

      // Filter to ONLY the seeded events so the assertion is scoped.
      await searchPage.performSearch(`ServiceName:"${markerService}"`);

      await searchPage.waitForTotalCountLoaded();

      await expect(searchPage.table.getRows()).toHaveCount(5);
      await expect(searchPage.totalCountText).toHaveText('5 Results');
    });
  },
);
