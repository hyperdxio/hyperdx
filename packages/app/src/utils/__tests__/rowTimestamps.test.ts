import {
  getRowLookupWindow,
  getTimestampValueSelects,
  resolveRowTimestampAnchor,
  ROW_LOOKUP_WINDOW_LEAD_HOURS,
  ROW_LOOKUP_WINDOW_LOOKBACK_HOURS,
  timestampValueAlias,
} from '@/utils/rowTimestamps';

describe('getTimestampValueSelects', () => {
  it('projects a single-column expression under the first alias', () => {
    expect(getTimestampValueSelects('Timestamp')).toEqual([
      { valueExpression: 'Timestamp', alias: '__hdx_timestamp_value_0' },
    ]);
  });

  it('projects every column of a composite expression', () => {
    expect(getTimestampValueSelects('EventDate, EventTime')).toEqual([
      { valueExpression: 'EventDate', alias: '__hdx_timestamp_value_0' },
      { valueExpression: 'EventTime', alias: '__hdx_timestamp_value_1' },
    ]);
  });

  // splitAndTrimWithBracket keeps bracketed argument lists intact, so a
  // function call with its own comma stays one token.
  it('does not split inside brackets', () => {
    expect(
      getTimestampValueSelects('toDate(EventTime), toDateTime64(EventTime, 9)'),
    ).toEqual([
      {
        valueExpression: 'toDate(EventTime)',
        alias: '__hdx_timestamp_value_0',
      },
      {
        valueExpression: 'toDateTime64(EventTime, 9)',
        alias: '__hdx_timestamp_value_1',
      },
    ]);
  });

  it.each([[undefined], [''], ['   ']])(
    'projects nothing for %p',
    expression => {
      expect(getTimestampValueSelects(expression)).toEqual([]);
    },
  );
});

describe('resolveRowTimestampAnchor', () => {
  const TIMESTAMP = '2024-05-01T14:23:11.123456789Z';

  function metaFor(types: string[]) {
    return types.map((type, index) => ({
      name: timestampValueAlias(index),
      type,
    }));
  }

  it('resolves a single DateTime64 column', () => {
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: TIMESTAMP },
        meta: metaFor(['DateTime64(9)']),
      }),
    ).toEqual(new Date(TIMESTAMP));
  });

  // Regression: a composite "EventDate, EventTime" sort key leads with the
  // day-precision partition column. Anchoring on it puts the instant at
  // midnight, and a narrow window around midnight excludes the event.
  it('skips the day-precision column of a composite expression', () => {
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'EventDate, EventTime',
        row: {
          __hdx_timestamp_value_0: '2024-05-01',
          __hdx_timestamp_value_1: TIMESTAMP,
        },
        meta: metaFor(['Date', 'DateTime64(9)']),
      }),
    ).toEqual(new Date(TIMESTAMP));
  });

  it('resolves the fine column regardless of token order', () => {
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'EventTime, EventDate',
        row: {
          __hdx_timestamp_value_0: TIMESTAMP,
          __hdx_timestamp_value_1: '2024-05-01',
        },
        meta: metaFor(['DateTime64(9)', 'Date32']),
      }),
    ).toEqual(new Date(TIMESTAMP));
  });

  it('prefers the highest-precision column', () => {
    const coarse = '2024-05-01T14:23:11Z';
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'EventSecond, EventNano',
        row: {
          __hdx_timestamp_value_0: coarse,
          __hdx_timestamp_value_1: TIMESTAMP,
        },
        meta: metaFor(['DateTime', 'DateTime64(9)']),
      }),
    ).toEqual(new Date(TIMESTAMP));
  });

  it('breaks precision ties on the earlier token', () => {
    const later = '2024-05-01T18:00:00.000Z';
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'EventTime, ObservedTime',
        row: {
          __hdx_timestamp_value_0: TIMESTAMP,
          __hdx_timestamp_value_1: later,
        },
        meta: metaFor(['DateTime64(9)', 'DateTime64(9)']),
      }),
    ).toEqual(new Date(TIMESTAMP));
  });

  it('looks through a Nullable wrapper and a timezone argument', () => {
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: TIMESTAMP },
        meta: metaFor(["Nullable(DateTime64(3, 'UTC'))"]),
      }),
    ).toEqual(new Date(TIMESTAMP));
  });

  it('treats a numeric value as unix seconds', () => {
    expect(
      resolveRowTimestampAnchor({
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: 1714573391 },
        meta: metaFor(['DateTime']),
      }),
    ).toEqual(new Date(1714573391 * 1000));
  });

  // Every rejection path returns undefined so callers fall back to an
  // unbounded lookup instead of a window around a bogus instant.
  it.each([
    [
      'every column is day-precision',
      {
        timestampValueExpression: 'EventDate, EventDate32',
        row: {
          __hdx_timestamp_value_0: '2024-05-01',
          __hdx_timestamp_value_1: '2024-05-01',
        },
        meta: metaFor(['Date', 'Date32']),
      },
    ],
    [
      'the column type is not a timestamp',
      {
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: TIMESTAMP },
        meta: metaFor(['String']),
      },
    ],
    [
      'meta has no entry for the alias',
      {
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: TIMESTAMP },
        meta: [{ name: 'Timestamp', type: 'DateTime64(9)' }],
      },
    ],
    [
      'the value is missing from the row',
      {
        timestampValueExpression: 'Timestamp',
        row: {},
        meta: metaFor(['DateTime64(9)']),
      },
    ],
    [
      'the value is unparseable',
      {
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: 'not-a-timestamp' },
        meta: metaFor(['DateTime64(9)']),
      },
    ],
    [
      'meta is unavailable',
      {
        timestampValueExpression: 'Timestamp',
        row: { __hdx_timestamp_value_0: TIMESTAMP },
        meta: undefined,
      },
    ],
    [
      'the row is missing',
      {
        timestampValueExpression: 'Timestamp',
        row: null,
        meta: metaFor(['DateTime64(9)']),
      },
    ],
    [
      'the source has no timestamp expression',
      {
        timestampValueExpression: '   ',
        row: { __hdx_timestamp_value_0: TIMESTAMP },
        meta: metaFor(['DateTime64(9)']),
      },
    ],
  ])('returns undefined when %s', (_label, args) => {
    expect(resolveRowTimestampAnchor(args)).toBeUndefined();
  });
});

describe('getRowLookupWindow', () => {
  it('reaches further back than forward', () => {
    // The whole point of the window: the destination span starts at or before
    // the origin log, so a symmetric window drops long-running spans.
    expect(ROW_LOOKUP_WINDOW_LOOKBACK_HOURS).toBeGreaterThan(
      ROW_LOOKUP_WINDOW_LEAD_HOURS,
    );
  });

  it('spans 4h back and 1h forward from the anchor', () => {
    expect(getRowLookupWindow('2024-05-02T12:00:00.000Z')).toEqual([
      new Date('2024-05-02T08:00:00.000Z'),
      new Date('2024-05-02T13:00:00.000Z'),
    ]);
  });

  // A log emitted well into a long span is the case a symmetric hour missed.
  it('covers a span that started hours before the log it anchors on', () => {
    const spanStart = new Date('2024-05-02T09:00:00.000Z');
    const logInstant = '2024-05-02T12:30:00.000Z';

    const [start, end] = getRowLookupWindow(logInstant)!;

    expect(start.getTime()).toBeLessThan(spanStart.getTime());
    expect(end.getTime()).toBeGreaterThan(new Date(logInstant).getTime());
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
    ['unparseable', 'not-a-timestamp'],
  ])('returns undefined when the anchor is %s', (_label, focusTimestamp) => {
    expect(getRowLookupWindow(focusTimestamp)).toBeUndefined();
  });
});
