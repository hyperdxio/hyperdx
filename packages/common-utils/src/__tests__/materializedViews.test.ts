import { inferGranularityFromMVSelect } from '@/core/materializedViews';

describe('inferGranularityFromMVSelect', () => {
  describe('real MV schemas', () => {
    // Shape matches the `otel_logs_attr_kv_rollup_15m_mv` view in
    // docker/otel-collector/schema/seed/00006_otel_logs_rollups.sql.
    it('detects 15 minute from the otel_logs kv rollup MV select', () => {
      const asSelect = `WITH elements AS (
    SELECT
        'ResourceAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM default.otel_logs
    ARRAY JOIN ResourceAttributes AS entry
    UNION ALL
    SELECT
        'LogAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM default.otel_logs
    ARRAY JOIN LogAttributes AS entry
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value`;

      expect(inferGranularityFromMVSelect(asSelect)).toBe('15 minute');
    });

    // Shape matches the `otel_traces_kv_rollup_15m_mv` view in
    // docker/otel-collector/schema/seed/00007_otel_traces_rollups.sql.
    it('detects 15 minute from the otel_traces kv rollup MV select', () => {
      const asSelect = `WITH elements AS (
    SELECT
        'ResourceAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM default.otel_traces
    ARRAY JOIN ResourceAttributes AS entry
    UNION ALL
    SELECT
        'SpanAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM default.otel_traces
    ARRAY JOIN SpanAttributes AS entry
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value`;

      expect(inferGranularityFromMVSelect(asSelect)).toBe('15 minute');
    });

    // The key-rollup MV rolls up the kv rollup, so it doesn't bucket the
    // timestamp itself — it just selects the already-bucketed Timestamp.
    it('returns undefined when the select contains no bucketing function', () => {
      const asSelect = `SELECT
    Timestamp,
    ColumnIdentifier,
    Key,
    sum(count) as count
FROM default.otel_logs_kv_rollup_15m
GROUP BY ColumnIdentifier, Key, Timestamp`;

      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });
  });

  describe('toStartOfInterval form', () => {
    it.each([
      ['INTERVAL 5 MINUTE', '5 minute'],
      ['INTERVAL 1 HOUR', '1 hour'],
      ['INTERVAL 2 hour', '2 hour'],
      ['INTERVAL 30 SECOND', '30 second'],
      ['INTERVAL 1 DAY', '1 day'],
    ])('parses %s', (interval, expected) => {
      const asSelect = `SELECT toStartOfInterval(Timestamp, ${interval}) AS ts, count() FROM t GROUP BY ts`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe(expected);
    });

    it('accepts plural units', () => {
      const asSelect = `SELECT toStartOfInterval(Timestamp, INTERVAL 10 MINUTES) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('10 minute');
    });

    it('handles extra arguments (origin, timezone)', () => {
      const asSelect = `SELECT toStartOfInterval(Timestamp, INTERVAL 1 DAY, toDateTime('2025-01-01'), 'America/Los_Angeles') AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('1 day');
    });

    it('handles extra whitespace and newlines inside the call', () => {
      const asSelect = `SELECT
    toStartOfInterval (
        Timestamp,
        INTERVAL   15   MINUTE
    ) AS ts
FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('15 minute');
    });

    it('ignores unknown units', () => {
      const asSelect = `SELECT toStartOfInterval(Timestamp, INTERVAL 1 WEEK) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });
  });

  describe('named bucket functions', () => {
    it.each([
      ['toStartOfSecond', '1 second'],
      ['toStartOfMinute', '1 minute'],
      ['toStartOfFiveMinutes', '5 minute'],
      ['toStartOfTenMinutes', '10 minute'],
      ['toStartOfFifteenMinutes', '15 minute'],
      ['toStartOfHour', '1 hour'],
      ['toStartOfDay', '1 day'],
    ])('maps %s to %s', (fn, expected) => {
      const asSelect = `SELECT ${fn}(Timestamp) AS ts, count() FROM t GROUP BY ts`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe(expected);
    });

    it('returns undefined for unrecognized toStartOf* functions', () => {
      // toStartOfMonth is a real CH function but not in NAMED_BUCKET_FUNCTIONS.
      const asSelect = `SELECT toStartOfMonth(Timestamp) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });
  });

  describe('first match wins', () => {
    it('returns the granularity of the first toStartOf call encountered', () => {
      const asSelect = `SELECT toStartOfHour(Timestamp) AS h, toStartOfMinute(Timestamp) AS m FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('1 hour');
    });

    it('returns first call even when a later call would also match', () => {
      const asSelect = `SELECT toStartOfInterval(Timestamp, INTERVAL 5 MINUTE) AS a, toStartOfHour(Timestamp) AS b FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('5 minute');
    });
  });

  describe('robustness against quoting and noise', () => {
    it('ignores toStartOf* tokens inside single-quoted string literals', () => {
      const asSelect = `SELECT 'toStartOfHour(Timestamp)' AS label, toStartOfMinute(Timestamp) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('1 minute');
    });

    it('ignores toStartOf* tokens inside backtick-quoted identifiers', () => {
      const asSelect = 'SELECT `toStartOfHour` AS col FROM t';
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });

    it('ignores toStartOf* substrings embedded in longer identifiers', () => {
      // my_toStartOfHour_col is a single identifier, not a function call.
      const asSelect = `SELECT my_toStartOfHour_col AS x FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });

    it('is not confused by commas inside nested calls', () => {
      const asSelect = `SELECT toStartOfInterval(coalesce(Timestamp, now()), INTERVAL 5 MINUTE) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBe('5 minute');
    });

    it('skips a toStartOf call without matching parens and stops scanning', () => {
      // Unterminated call — we stop rather than looping forever.
      const asSelect = `SELECT toStartOfHour(Timestamp FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });
  });

  describe('degenerate inputs', () => {
    it('returns undefined for empty string', () => {
      expect(inferGranularityFromMVSelect('')).toBeUndefined();
    });

    it('returns undefined when no toStartOf call is present', () => {
      const asSelect = `SELECT Timestamp, count() FROM t GROUP BY Timestamp`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });

    it('returns undefined when toStartOfInterval has no interval arg', () => {
      const asSelect = `SELECT toStartOfInterval(Timestamp) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });

    it('returns undefined when toStartOfInterval has a malformed interval arg', () => {
      const asSelect = `SELECT toStartOfInterval(Timestamp, INTERVAL abc MINUTE) AS ts FROM t`;
      expect(inferGranularityFromMVSelect(asSelect)).toBeUndefined();
    });
  });
});
