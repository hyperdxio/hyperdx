import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import { queryLabelValues } from '@/controllers/timeseriesEngine';
import {
  closeTestFixtureClickHouseClient,
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  executeSqlCommand,
  seedTimeSeriesTagsTable,
} from '@/fixtures';

const CONNECTION_ID = 'timeseries-engine-int-test';
const BOUNDED_TABLE = 'test_ts_label_values';
const UNBOUNDED_TABLE = 'test_ts_label_values_no_bounds';

const HOUR_SEC = 3600;
const OLD_START_SEC = 1600000000;
const RECENT_START_SEC = 1700000000;
const sec = (s: number) => s * 1000;

// Three series: one only in the distant past, two only in the recent window
// sharing a metric name (so DISTINCT has something to collapse).
const SERIES = [
  {
    metricName: 'old_metric',
    tags: { job: 'batch' },
    startSec: OLD_START_SEC,
    endSec: OLD_START_SEC + HOUR_SEC,
  },
  {
    metricName: 'recent_metric',
    tags: { job: 'api' },
    startSec: RECENT_START_SEC,
    endSec: RECENT_START_SEC + HOUR_SEC,
  },
  {
    metricName: 'recent_metric',
    tags: { job: 'web' },
    startSec: RECENT_START_SEC,
    endSec: RECENT_START_SEC + HOUR_SEC,
  },
];

describe('timeseriesEngine controller', () => {
  let client: ClickhouseClient;

  const labelValues = (
    args: Partial<Parameters<typeof queryLabelValues>[0]> & {
      labelName: string;
    },
  ) =>
    queryLabelValues({
      client,
      connectionId: CONNECTION_ID,
      databaseName: DEFAULT_DATABASE,
      tableName: BOUNDED_TABLE,
      ...args,
    });

  beforeAll(async () => {
    client = new ClickhouseClient({
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    await seedTimeSeriesTagsTable({ table: BOUNDED_TABLE, series: SERIES });
    await seedTimeSeriesTagsTable({
      table: UNBOUNDED_TABLE,
      series: SERIES,
      storeTimeBounds: false,
    });
  });

  afterAll(async () => {
    for (const table of [BOUNDED_TABLE, UNBOUNDED_TABLE]) {
      await dropTimeSeriesTable({ table });
    }
    await client.close();
    await closeTestFixtureClickHouseClient();
  });

  describe('queryLabelValues', () => {
    describe('__name__', () => {
      it('returns every metric name, deduplicated and sorted', async () => {
        expect(await labelValues({ labelName: '__name__' })).toEqual([
          'old_metric',
          'recent_metric',
        ]);
      });

      it('keeps only metrics whose series overlap the window', async () => {
        expect(
          await labelValues({
            labelName: '__name__',
            startMs: sec(RECENT_START_SEC),
            endMs: sec(RECENT_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['recent_metric']);

        expect(
          await labelValues({
            labelName: '__name__',
            startMs: sec(OLD_START_SEC),
            endMs: sec(OLD_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['old_metric']);
      });

      // A lone `end` bounds min_time (nothing may start after the window) and a
      // lone `start` bounds max_time (nothing may end before it). Getting the
      // pairing backwards still filters, just wrongly, so both directions are
      // pinned.
      it('applies a lone end bound against min_time', async () => {
        expect(
          await labelValues({
            labelName: '__name__',
            endMs: sec(OLD_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['old_metric']);
      });

      it('applies a lone start bound against max_time', async () => {
        expect(
          await labelValues({
            labelName: '__name__',
            startMs: sec(RECENT_START_SEC),
          }),
        ).toEqual(['recent_metric']);
      });

      it('returns nothing for a window no series covers', async () => {
        expect(
          await labelValues({
            labelName: '__name__',
            startMs: sec(OLD_START_SEC + 2 * HOUR_SEC),
            endMs: sec(OLD_START_SEC + 3 * HOUR_SEC),
          }),
        ).toEqual([]);
      });
    });

    describe('tag labels', () => {
      it('returns the label values, deduplicated and sorted', async () => {
        expect(await labelValues({ labelName: 'job' })).toEqual([
          'api',
          'batch',
          'web',
        ]);
      });

      it('scopes label values to the window', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            startMs: sec(RECENT_START_SEC),
            endMs: sec(RECENT_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['api', 'web']);
      });

      it('returns nothing for a label no series carries', async () => {
        expect(await labelValues({ labelName: 'instance' })).toEqual([]);
      });

      // The label name reaches both the WHERE clause and the value expression.
      // Parameterized, this is an ordinary miss; interpolated, it is a syntax
      // error — so the assertion is "empty", not "throws".
      it('parameterizes the label name rather than interpolating it', async () => {
        expect(await labelValues({ labelName: `job') OR 1=1 --` })).toEqual([]);
      });
    });

    describe('limit', () => {
      it('caps the number of values returned, keeping the ordering', async () => {
        expect(await labelValues({ labelName: '__name__', limit: 1 })).toEqual([
          'old_metric',
        ]);
      });

      // Prometheus reads limit=0 as unlimited, so it must not become `LIMIT 0`.
      it('treats a zero limit as unlimited', async () => {
        expect(await labelValues({ labelName: '__name__', limit: 0 })).toEqual([
          'old_metric',
          'recent_metric',
        ]);
      });

      it('returns everything when the limit exceeds the result set', async () => {
        expect(
          await labelValues({ labelName: '__name__', limit: 100 }),
        ).toEqual(['old_metric', 'recent_metric']);
      });
    });

    // store_min_time_and_max_time = 0 leaves the tags table without the columns
    // the predicate reads, and referencing a missing column is a hard error.
    // Time bounds are best-effort narrowing, so the request widens instead.
    describe('table without min_time/max_time', () => {
      it('ignores the bounds instead of failing', async () => {
        expect(
          await queryLabelValues({
            client,
            connectionId: CONNECTION_ID,
            databaseName: DEFAULT_DATABASE,
            tableName: UNBOUNDED_TABLE,
            labelName: '__name__',
            startMs: sec(RECENT_START_SEC),
            endMs: sec(RECENT_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['old_metric', 'recent_metric']);
      });

      it('still filters on the label itself', async () => {
        expect(
          await queryLabelValues({
            client,
            connectionId: CONNECTION_ID,
            databaseName: DEFAULT_DATABASE,
            tableName: UNBOUNDED_TABLE,
            labelName: 'job',
          }),
        ).toEqual(['api', 'batch', 'web']);
      });
    });

    it('rejects when the table is not a TimeSeries table', async () => {
      await executeSqlCommand(
        `CREATE OR REPLACE TABLE ${DEFAULT_DATABASE}.test_ts_plain (ts DateTime) ENGINE = MergeTree ORDER BY ts`,
      );
      try {
        await expect(
          labelValues({
            labelName: '__name__',
            tableName: 'test_ts_plain',
          }),
        ).rejects.toThrow(/TimeSeries table only/);
      } finally {
        await executeSqlCommand(
          `DROP TABLE IF EXISTS ${DEFAULT_DATABASE}.test_ts_plain`,
        );
      }
    });
  });
});
