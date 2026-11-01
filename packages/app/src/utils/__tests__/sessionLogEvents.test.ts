import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';

import {
  buildSessionLogEventsQuery,
  mergeLogMarkers,
  SessionLogEvent,
} from '@/utils/sessionLogEvents';

const logSource: TLogSource = {
  id: 'logs',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'TimestampTime, Timestamp',
  displayedTimestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  implicitColumnExpression: 'Body',
  serviceNameExpression: 'ServiceName',
  resourceAttributesExpression: 'ResourceAttributes',
  eventAttributesExpression: 'LogAttributes',
  eventNameExpression: 'EventName',
};

const dateRange: [Date, Date] = [
  new Date('2026-10-22T00:00:00Z'),
  new Date('2026-10-22T08:00:00Z'),
];

const args = {
  logSource,
  sessionId: 's1',
  sessionIdKey: 'session.id' as const,
  serviceName: 'web',
  searchedQuery: '',
  dateRange,
  tab: 'highlighted',
  sessionIdExpression: "LogAttributes['session.id']",
  consoleMethodExpression: "LogAttributes['browser.console.method']",
};

describe('buildSessionLogEventsQuery', () => {
  it.each([
    ['a legacy session', { sessionIdKey: 'rum.sessionId' as const }],
    ['no log source', { logSource: undefined }],
    [
      'no event name expression',
      { logSource: { ...logSource, eventNameExpression: undefined } },
    ],
    [
      'no event attributes expression',
      { logSource: { ...logSource, eventAttributesExpression: undefined } },
    ],
    ['an active search', { searchedQuery: 'SpanName:foo' }],
  ])('builds nothing for %s', (_case, override) => {
    expect(buildSessionLogEventsQuery({ ...args, ...override })).toBeNull();
  });

  it('looks up the session on the log source, newest last', () => {
    const { config, aliasMap } = buildSessionLogEventsQuery(args)!;

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
      dateRange,
      orderBy: 'Timestamp ASC',
      limit: { limit: 4000, offset: 0 },
      filters: [
        { type: 'lucene', condition: 'LogAttributes.session.id:"s1"' },
        expect.anything(),
        { type: 'sql', condition: "ServiceName = 'web'" },
      ],
    });
  });

  it.each([
    [
      'highlighted',
      "toString(EventName) IN ('browser.navigation', 'exception') OR (toString(EventName) = 'browser.console' AND LogAttributes['browser.console.method'] = 'error')",
    ],
    [
      'events',
      "toString(EventName) IN ('browser.user_action.click', 'browser.navigation', 'exception', 'browser.console')",
    ],
  ])('filters event names for the %s tab', (tab, condition) => {
    expect(
      buildSessionLogEventsQuery({ ...args, tab })!.config.filters?.[1],
    ).toEqual({ type: 'sql', condition });
  });

  it('skips the service filter when the session has no service', () => {
    expect(
      buildSessionLogEventsQuery({ ...args, serviceName: '' })!.config.filters,
    ).toHaveLength(2);
  });

  it('wraps a custom event name expression verbatim', () => {
    const { config } = buildSessionLogEventsQuery({
      ...args,
      tab: 'events',
      logSource: {
        ...logSource,
        eventNameExpression: "LogAttributes['event.name?']",
      },
    })!;

    expect(config.filters?.[1]).toMatchObject({
      condition: expect.stringMatching(
        /^toString\(LogAttributes\['event\.name\?'\]\) IN \('browser/,
      ),
    });
  });
});

describe('mergeLogMarkers', () => {
  const spanMarker = {
    id: 'span',
    ts: 1000,
    description: '500 GET /api',
    isError: true,
    isSuccess: false,
  };
  const logEvent = (ts: number, id: string): SessionLogEvent => ({
    id,
    timestamp: new Date(ts),
    title: 'Clicked button',
    description: '',
    timelineText: 'Clicked button',
    isError: false,
    eventSource: 'custom',
    row: {},
  });

  it('returns the span markers themselves when no log event is in range', () => {
    const spanMarkers = [spanMarker];

    expect(
      mergeLogMarkers(spanMarkers, [logEvent(5000, 'late')], 0, 2000),
    ).toBe(spanMarkers);
  });

  it('merges by time and keeps the earliest marker per percent, spans first', () => {
    expect(
      mergeLogMarkers(
        [spanMarker],
        [logEvent(1000, 'tie'), logEvent(500, 'early'), logEvent(1500, 'late')],
        0,
        2000,
      ).map(marker => marker.id),
    ).toEqual(['early', 'span', 'late']);
  });
});
