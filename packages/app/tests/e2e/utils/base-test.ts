import { expect, test as base } from '@playwright/test';

import { TestUtils } from './test-setup';

// Extend the base test to automatically handle Tanstack devtools
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('TanstackQueryDevtools.open', 'false');
      window.sessionStorage.setItem(
        'connections',
        '[{"name":"Demo","host":"https://sql-clickhouse.clickhouse.com","username":"otel_demo","password":"","id":"local"}]',
      );
      window.localStorage.setItem(
        'hdx-local-source',
        JSON.stringify([
          {
            kind: 'log',
            name: 'Demo Logs',
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
            name: 'Demo Traces',
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
            name: 'Demo Metrics',
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
            name: 'Demo Sessions',
            connection: 'local',
            from: { databaseName: 'otel_v2', tableName: 'hyperdx_sessions' },
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
          {
            kind: 'trace',
            name: 'ClickPy Traces',
            connection: 'local',
            from: { databaseName: 'otel_clickpy', tableName: 'otel_traces' },
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
            statusCodeExpression: 'StatusCode',
            statusMessageExpression: 'StatusMessage',
            spanEventsValueExpression: 'Events',
            id: 'l-1156687249',
            sessionSourceId: 'l-1709901146',
          },
          {
            kind: 'session',
            name: 'ClickPy Sessions',
            connection: 'local',
            from: {
              databaseName: 'otel_clickpy',
              tableName: 'hyperdx_sessions',
            },
            timestampValueExpression: 'TimestampTime',
            defaultTableSelectExpression: 'Timestamp, ServiceName, Body',
            serviceNameExpression: 'ServiceName',
            severityTextExpression: 'SeverityText',
            eventAttributesExpression: 'LogAttributes',
            resourceAttributesExpression: 'ResourceAttributes',
            traceSourceId: 'l-1156687249',
            traceIdExpression: 'TraceId',
            spanIdExpression: 'SpanId',
            implicitColumnExpression: 'Body',
            id: 'l-1709901146',
          },
        ]),
      );
    });
    // // Override the goto method to handle modals and devtools after navigation
    // const originalGoto = page.goto.bind(page);
    // page.goto = async (url: string, options?: any) => {
    //   const result = await originalGoto(url, options);
    //   await page.waitForLoadState('networkidle');

    //   // Handle onboarding modal
    //   //await TestUtils.handleOnboardingModal(page);
    //   return result;
    // };

    // Use the enhanced page
    await use(page);
  },
});

export { expect };

// Export TestUtils for convenience
export { TestUtils };
