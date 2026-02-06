import { expect, test as base } from '@playwright/test';

import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_SESSIONS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from './constants';

const USE_FULLSTACK = process.env.E2E_FULLSTACK === 'true';

// Extend the base test to automatically handle Tanstack devtools
export const test = base.extend({
  page: async ({ page }, fn) => {
    // Note: page.addInitScript runs in the browser context, which cannot access Node.js
    // environment variables directly. We pass USE_FULLSTACK as a parameter so the browser
    // script can determine whether to set up demo connections (local mode) or rely on
    // API-provided connections (full-stack mode).
    await page.addInitScript(
      ([
        isFullstack,
        DEFAULT_LOGS_SOURCE_NAME,
        DEFAULT_TRACES_SOURCE_NAME,
        DEFAULT_METRICS_SOURCE_NAME,
        DEFAULT_SESSIONS_SOURCE_NAME,
      ]) => {
        window.localStorage.setItem('TanstackQueryDevtools.open', 'false');

        // Only set up demo connections for local mode
        if (!isFullstack) {
          window.sessionStorage.setItem(
            'connections',
            '[{"name":"Demo","host":"https://sql-clickhouse.clickhouse.com","username":"otel_demo","password":"","id":"local"}]',
          );
          window.localStorage.setItem(
            'hdx-local-source',
            JSON.stringify([
              {
                kind: 'log',
                name: DEFAULT_LOGS_SOURCE_NAME,
                connection: 'local',
                from: { databaseName: 'otel_v2', tableName: 'otel_logs' },
                timestampValueExpression: 'TimestampTime',
                defaultTableSelectExpression:
                  'Timestamp, ServiceName, SeverityText, Body',
                serviceNameExpression: 'ServiceName',
                severityTextExpression: 'SeverityText',
                eventAttributesExpression: 'LogAttributes',
                resourceAttributesExpression: 'ResourceAttributes',
                traceIdExpression: 'TraceId',
                spanIdExpression: 'SpanId',
                implicitColumnExpression: 'Body',
                displayedTimestampValueExpression: 'Timestamp',
                id: 'l956912644',
                sessionSourceId: 'l1155456738',
                traceSourceId: 'l1073165478',
                metricSourceId: 'l-517210123',
              },
              {
                kind: 'trace',
                name: DEFAULT_TRACES_SOURCE_NAME,
                connection: 'local',
                from: { databaseName: 'otel_v2', tableName: 'otel_traces' },
                timestampValueExpression: 'Timestamp',
                defaultTableSelectExpression:
                  'Timestamp, ServiceName, StatusCode, round(Duration / 1e6), SpanName',
                serviceNameExpression: 'ServiceName',
                eventAttributesExpression: 'SpanAttributes',
                resourceAttributesExpression: 'ResourceAttributes',
                traceIdExpression: 'TraceId',
                spanIdExpression: 'SpanId',
                implicitColumnExpression: 'SpanName',
                durationExpression: 'Duration',
                durationPrecision: 9,
                parentSpanIdExpression: 'ParentSpanId',
                spanKindExpression: 'SpanKind',
                spanNameExpression: 'SpanName',
                logSourceId: 'l956912644',
                statusCodeExpression: 'StatusCode',
                statusMessageExpression: 'StatusMessage',
                spanEventsValueExpression: 'Events',
                id: 'l1073165478',
                metricSourceId: 'l-517210123',
                sessionSourceId: 'l1155456738',
              },
              {
                kind: 'metric',
                name: DEFAULT_METRICS_SOURCE_NAME,
                connection: 'local',
                from: { databaseName: 'otel_v2', tableName: '' },
                timestampValueExpression: 'TimeUnix',
                serviceNameExpression: 'ServiceName',
                metricTables: {
                  gauge: 'otel_metrics_gauge',
                  histogram: 'otel_metrics_histogram',
                  sum: 'otel_metrics_sum',
                  summary: 'otel_metrics_summary',
                  'exponential histogram': 'otel_metrics_exponential_histogram',
                },
                resourceAttributesExpression: 'ResourceAttributes',
                logSourceId: 'l956912644',
                id: 'l-517210123',
              },
              {
                kind: 'session',
                name: DEFAULT_SESSIONS_SOURCE_NAME,
                connection: 'local',
                from: {
                  databaseName: 'otel_v2',
                  tableName: 'hyperdx_sessions',
                },
                timestampValueExpression: 'TimestampTime',
                defaultTableSelectExpression: 'Timestamp, ServiceName, Body',
                serviceNameExpression: 'ServiceName',
                severityTextExpression: 'SeverityText',
                eventAttributesExpression: 'LogAttributes',
                resourceAttributesExpression: 'ResourceAttributes',
                traceSourceId: 'l1073165478',
                traceIdExpression: 'TraceId',
                spanIdExpression: 'SpanId',
                implicitColumnExpression: 'Body',
                id: 'l1155456738',
              },
            ]),
          );
        }
      },
      [
        USE_FULLSTACK,
        DEFAULT_LOGS_SOURCE_NAME,
        DEFAULT_TRACES_SOURCE_NAME,
        DEFAULT_METRICS_SOURCE_NAME,
        DEFAULT_SESSIONS_SOURCE_NAME,
      ],
    );
    await fn(page);
  },
});

export { expect };
