import { SourceKind } from '@hyperdx/common-utils/dist/types';

import type { BrowserEventLogSource } from '@/utils/browserTraceContext';

export const logSource: BrowserEventLogSource = {
  id: 'logs',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  implicitColumnExpression: 'Body',
  serviceNameExpression: 'ServiceName',
  eventNameExpression: 'EventName',
  eventAttributesExpression: 'LogAttributes',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
};

export const PAGE_URL = 'http://localhost:5173/';
export const SPAN_START = '2026-10-22T04:52:37.818000000Z';
export const SPAN_START_MS = Date.parse('2026-10-22T04:52:37.818Z');
export const TIMING_TIMESTAMP = '2026-10-22T04:52:37.838000000Z';
export const CLICK_TIMESTAMP = '2026-10-22T04:52:37.815000000Z';

export const browserSpan = {
  Timestamp: SPAN_START,
  Duration: 0.012,
  SpanId: 'span-1',
  ServiceName: 'web',
  SpanAttributes: {
    'browser.document.url.full': PAGE_URL,
    'session.id': 's1',
  },
};
export const legacySpan = {
  ...browserSpan,
  SpanAttributes: { 'http.url': 'http://localhost:5173/api' },
};

const timingLogRow = {
  id: 'timing-row',
  Timestamp: TIMING_TIMESTAMP,
  SpanId: 'span-1',
  Body: '',
};
export const consoleLogRow = {
  id: 'console-row',
  Timestamp: '2026-10-22T04:52:37.825000000Z',
  SpanId: 'span-1',
  Body: 'loading cart',
};
export const logRows = [timingLogRow, consoleLogRow];

export const timingResult = {
  data: [
    {
      span_id: 'span-1',
      timestamp: TIMING_TIMESTAMP,
      attributes: {
        'browser.resource_timing.fetch_start': '1000.5',
        'browser.resource_timing.response_end': '1011.5',
      },
    },
  ],
  meta: [{ name: 'timestamp', type: 'DateTime64(9)' }],
};

export const clickResult = {
  data: [
    {
      timestamp: CLICK_TIMESTAMP,
      event_name: 'browser.user_action.click',
      session_id: 's1',
      body: '',
      attributes: {
        'browser.tag_name': 'BUTTON',
        'browser.element.attributes.testid': 'checkout',
      },
    },
  ],
  meta: [
    { name: 'timestamp', type: 'DateTime64(9)' },
    { name: 'event_name', type: 'String' },
    { name: 'session_id', type: 'String' },
    { name: 'body', type: 'String' },
    { name: 'attributes', type: 'Map(LowCardinality(String), String)' },
  ],
};
