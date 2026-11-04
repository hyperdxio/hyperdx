import {
  logSource,
  SPAN_START,
  SPAN_START_MS,
} from '@/hooks/__fixtures__/browserTraceEvents';
import type { BrowserTraceContext } from '@/utils/browserTraceContext';
import {
  buildTriggerClickQuery,
  pickTriggerClick,
} from '@/utils/traceTriggerClick';

const context: BrowserTraceContext = {
  serviceNames: ['web'],
  anchorMs: SPAN_START_MS,
  endMs: SPAN_START_MS + 12,
  anchorHidden: false,
  sessionId: 's1',
  serviceName: 'web',
};

const args = {
  logSource: {
    ...logSource,
    timestampValueExpression: 'TimestampTime, Timestamp',
    displayedTimestampValueExpression: 'Timestamp',
  },
  context,
  sessionId: 's1',
  sessionIdExpression: "LogAttributes['session.id']",
};

const click = (timestamp: string, attributes: object = {}) => ({
  timestamp,
  event_name: 'browser.user_action.click',
  body: '',
  attributes: { 'browser.tag_name': 'BUTTON', ...attributes },
});

const clicks = (...data: ReturnType<typeof click>[]) => ({
  data,
  meta: [{ name: 'timestamp', type: 'DateTime64(9)' }],
});

describe('buildTriggerClickQuery', () => {
  it("looks up the latest clicks of the anchor span's session and service", () => {
    const { config, aliasMap } = buildTriggerClickQuery(args);

    expect(aliasMap).toEqual({
      timestamp: 'Timestamp',
      timestamp_key: 'TimestampTime',
      event_name: 'toString(EventName)',
      session_id: "LogAttributes['session.id']",
      body: 'Body',
      attributes: 'LogAttributes',
    });
    expect(config).toMatchObject({
      source: 'logs',
      from: logSource.from,
      connection: 'conn',
      timestampValueExpression: 'TimestampTime, Timestamp',
      filters: [
        { type: 'lucene', condition: 'LogAttributes.session.id:"s1"' },
        {
          type: 'sql',
          condition: "toString(EventName) = 'browser.user_action.click'",
        },
        { type: 'sql', condition: "ServiceName = 'web'" },
      ],
      orderBy: 'Timestamp DESC',
      limit: { limit: 10 },
    });
  });

  it.each([
    [
      'the lookback across a second boundary',
      Date.parse('2026-10-22T04:52:38.100Z'),
      ['2026-10-22T04:52:37.000Z', '2026-10-22T04:52:38.100Z'],
    ],
    [
      'an anchor on a whole second',
      Date.parse('2026-10-22T04:52:38.000Z'),
      ['2026-10-22T04:52:37.000Z', '2026-10-22T04:52:38.000Z'],
    ],
  ])(
    'floors the window start to the second and ends at the anchor for %s',
    (_case, anchorMs, range) => {
      expect(
        buildTriggerClickQuery({ ...args, context: { ...context, anchorMs } })
          .config.dateRange,
      ).toEqual(range.map(iso => new Date(iso)));
    },
  );
});

describe('pickTriggerClick', () => {
  it('picks the latest click at or before the anchor', () => {
    const latest = click('2026-10-22T04:52:37.815000000Z');
    const rows = clicks(
      click('2026-10-22T04:52:37.819000000Z'),
      latest,
      click('2026-10-22T04:52:37.700000000Z'),
    );

    expect(pickTriggerClick(rows, SPAN_START_MS)).toEqual({
      row: latest,
      gapMs: 3,
    });
  });

  it.each([
    ['in the same millisecond as the anchor', SPAN_START, 0],
    ['at the edge of the lookback', '2026-10-22T04:52:37.568000000Z', 250],
  ])('takes a click %s', (_case, timestamp, gapMs) => {
    const row = click(timestamp);

    expect(pickTriggerClick(clicks(row), SPAN_START_MS)).toEqual({
      row,
      gapMs,
    });
  });

  it.each([
    ['after the anchor in the same second', '2026-10-22T04:52:37.900000000Z'],
    ['older than the lookback', '2026-10-22T04:52:37.567000000Z'],
    ['with an unparsable timestamp', 'not-a-timestamp'],
  ])('ignores a click %s', (_case, timestamp) => {
    expect(
      pickTriggerClick(clicks(click(timestamp)), SPAN_START_MS),
    ).toBeUndefined();
  });

  it('ignores clicks in a whole-second timestamp column', () => {
    expect(
      pickTriggerClick(
        {
          data: [click('2026-10-22T04:52:37Z')],
          meta: [{ name: 'timestamp', type: 'DateTime' }],
        },
        Date.parse('2026-10-22T04:52:37.100Z'),
      ),
    ).toBeUndefined();
  });

  it('matches a click recorded on another page URL', () => {
    const row = click('2026-10-22T04:52:37.816000000Z', {
      'browser.document.url.full': 'http://localhost:5173/cart?tab=items',
    });

    expect(pickTriggerClick(clicks(row), SPAN_START_MS)?.row).toBe(row);
  });
});
