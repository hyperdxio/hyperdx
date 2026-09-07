import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import {
  queryLabelNames,
  queryLabelValues,
} from '@/controllers/timeseriesEngine';
import {
  closeTestFixtureClickHouseClient,
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  executeSqlCommand,
  seedTimeSeriesTagsTable,
  TimeSeriesFixtureSeries,
} from '@/fixtures';

const CONNECTION_ID = 'timeseries-engine-int-test';
const BOUNDED_TABLE = 'test_ts_label_values';
const UNBOUNDED_TABLE = 'test_ts_label_values_no_bounds';

const HOUR_SEC = 3600;
const OLD_START_SEC = 1600000000;
const RECENT_START_SEC = 1700000000;
const sec = (s: number) => s * 1000;

// Three series: one only in the distant past, two only in the recent window
// sharing a metric name (so DISTINCT has something to collapse). Only the old
// series carries `region`, so a window can exclude a label name too.
const SERIES: TimeSeriesFixtureSeries[] = [
  {
    metricName: 'old_metric',
    tags: { job: 'batch', region: 'eu' },
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
    await seedTimeSeriesTagsTable({
      table: BOUNDED_TABLE,
      series: SERIES,
      withSamples: true,
    });
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

    // A selector matches a series only if it has a sample in the window, which
    // is why BOUNDED_TABLE is seeded with samples.
    describe('match[] selectors', () => {
      it('keeps only the values carried by matching series', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            match: ['recent_metric{job="api"}'],
          }),
        ).toEqual(['api']);
      });

      // Prometheus unions the selectors rather than intersecting them.
      it('unions the series matched by each selector', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            match: ['recent_metric{job="api"}', 'old_metric'],
          }),
        ).toEqual(['api', 'batch']);
      });

      it('scopes metric names to the selector', async () => {
        expect(
          await labelValues({
            labelName: '__name__',
            match: ['{job="batch"}'],
          }),
        ).toEqual(['old_metric']);
      });

      it('evaluates regex matchers', async () => {
        expect(
          await labelValues({
            labelName: '__name__',
            match: ['{job=~"a.*|w.*"}'],
          }),
        ).toEqual(['recent_metric']);
      });

      // Both filters have to survive: the selector alone would answer with
      // every job, the window alone with every recent one.
      it('narrows the selector by the time window', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            match: ['{job=~".+"}'],
            startMs: sec(RECENT_START_SEC),
            endMs: sec(RECENT_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['api', 'web']);
      });

      it('returns nothing when no series matches', async () => {
        expect(
          await labelValues({ labelName: 'job', match: ['absent_metric'] }),
        ).toEqual([]);
      });

      it('treats an empty selector list as no filter', async () => {
        expect(await labelValues({ labelName: 'job', match: [] })).toEqual([
          'api',
          'batch',
          'web',
        ]);
      });

      it('surfaces a malformed selector as an error', async () => {
        await expect(
          labelValues({ labelName: 'job', match: ['recent_metric{'] }),
        ).rejects.toThrow(/while parsing PromQL query/);
      });

      // A selector is caller-supplied text. Interpolated, this closes the
      // enclosing string and the query fails; parameterized, it is a plain miss
      // — so the assertion is "empty", not "throws".
      it('parameterizes the selector rather than interpolating it', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            match: [`{job="a') OR 1=1 --"}`],
          }),
        ).toEqual([]);
      });

      it('collapses a repeated identical selector', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            match: ['old_metric', 'old_metric'],
          }),
        ).toEqual(['batch']);
      });

      it('applies the limit after the selector', async () => {
        expect(
          await labelValues({
            labelName: 'job',
            match: ['{job=~".+"}'],
            limit: 1,
          }),
        ).toEqual(['api']);
      });

      // The label predicate and the selector have to AND together rather than
      // one standing in for the other.
      it('returns nothing when the matched series lack the label', async () => {
        expect(
          await labelValues({ labelName: 'region', match: ['recent_metric'] }),
        ).toEqual([]);
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

      // A selector needs those columns to evaluate at all. Unlike the bounds it
      // cannot degrade to "no filter" — that would answer a different question.
      it('rejects match[] rather than dropping it', async () => {
        await expect(
          queryLabelValues({
            client,
            connectionId: CONNECTION_ID,
            databaseName: DEFAULT_DATABASE,
            tableName: UNBOUNDED_TABLE,
            labelName: 'job',
            match: ['recent_metric'],
          }),
        ).rejects.toThrow(/store_min_time_and_max_time = 1/);
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

  describe('queryLabelNames', () => {
    const labelNames = (
      args: Partial<Parameters<typeof queryLabelNames>[0]> = {},
    ) =>
      queryLabelNames({
        client,
        connectionId: CONNECTION_ID,
        databaseName: DEFAULT_DATABASE,
        tableName: BOUNDED_TABLE,
        ...args,
      });

    // `__name__` is not a key of `tags`, so it only appears if folded back in.
    it('returns every label name including __name__, deduplicated and sorted', async () => {
      expect(await labelNames()).toEqual(['__name__', 'job', 'region']);
    });

    it('keeps only labels carried by series overlapping the window', async () => {
      expect(
        await labelNames({
          startMs: sec(RECENT_START_SEC),
          endMs: sec(RECENT_START_SEC + HOUR_SEC),
        }),
      ).toEqual(['__name__', 'job']);
    });

    it('returns nothing for a window no series covers', async () => {
      expect(
        await labelNames({
          startMs: sec(OLD_START_SEC + 2 * HOUR_SEC),
          endMs: sec(OLD_START_SEC + 3 * HOUR_SEC),
        }),
      ).toEqual([]);
    });

    it('caps the number of names returned, keeping the ordering', async () => {
      expect(await labelNames({ limit: 2 })).toEqual(['__name__', 'job']);
    });

    it('treats a zero limit as unlimited', async () => {
      expect(await labelNames({ limit: 0 })).toEqual([
        '__name__',
        'job',
        'region',
      ]);
    });

    it('ignores the bounds on a table without min_time/max_time', async () => {
      expect(
        await labelNames({
          tableName: UNBOUNDED_TABLE,
          startMs: sec(RECENT_START_SEC),
          endMs: sec(RECENT_START_SEC + HOUR_SEC),
        }),
      ).toEqual(['__name__', 'job', 'region']);
    });

    describe('match[] selectors', () => {
      // Only the old series carries `region`, so a selector that excludes it
      // has to drop a label name from the answer.
      it('keeps only the names carried by matching series', async () => {
        expect(await labelNames({ match: ['recent_metric'] })).toEqual([
          '__name__',
          'job',
        ]);
      });

      it('unions the series matched by each selector', async () => {
        expect(
          await labelNames({ match: ['{job="web"}', 'old_metric'] }),
        ).toEqual(['__name__', 'job', 'region']);
      });

      // Both filters have to survive: the selector alone would answer with
      // `region` too, the window alone with every recent label.
      it('narrows the selector by the time window', async () => {
        expect(
          await labelNames({
            match: ['{job=~".+"}'],
            startMs: sec(RECENT_START_SEC),
            endMs: sec(RECENT_START_SEC + HOUR_SEC),
          }),
        ).toEqual(['__name__', 'job']);
      });

      it('returns nothing when no series matches', async () => {
        expect(await labelNames({ match: ['absent_metric'] })).toEqual([]);
      });

      it('rejects match[] on a table without min_time/max_time', async () => {
        await expect(
          labelNames({ tableName: UNBOUNDED_TABLE, match: ['recent_metric'] }),
        ).rejects.toThrow(/store_min_time_and_max_time = 1/);
      });
    });
  });
});
