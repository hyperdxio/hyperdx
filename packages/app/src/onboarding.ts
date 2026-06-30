import { useCallback, useEffect, useState } from 'react';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import {
  isLogSource,
  isTraceSource,
  MetricsDataType,
  SourceKind,
  TLogSource,
  TSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { IS_CLICKHOUSE_BUILD } from '@/config';
import { useConnections, useCreateConnection } from '@/connection';
import {
  useCreateSource,
  useDeleteSource,
  useSources,
  useUpdateSource,
} from '@/source';

/**
 * Create the canonical OTel demo sources (logs / traces / metrics / sessions)
 * for a connection, wiring up the cross-source links. Shared by the onboarding
 * modal and the getting-started page.
 */
async function addOtelDemoSources({
  connectionId,
  createSourceMutation,
  updateSourceMutation,

  logSourceDatabaseName,
  logSourceName,
  logSourceTableName,

  metricsSourceDatabaseName,
  metricsSourceName,

  sessionSourceDatabaseName,
  sessionSourceName,
  sessionSourceTableName,

  traceSourceDatabaseName,
  traceSourceName,
  traceSourceTableName,
  traceSourceHighlightedTraceAttributes,
  traceSourceMaterializedViews,
}: {
  connectionId: string;
  createSourceMutation: ReturnType<typeof useCreateSource>;
  createConnectionMutation: ReturnType<typeof useCreateConnection>;
  updateSourceMutation: ReturnType<typeof useUpdateSource>;
  deleteSourceMutation: ReturnType<typeof useDeleteSource>;

  logSourceDatabaseName?: string;
  logSourceName?: string;
  logSourceTableName?: string;

  metricsSourceDatabaseName?: string;
  metricsSourceName?: string;

  sessionSourceDatabaseName: string;
  sessionSourceName: string;
  sessionSourceTableName: string;

  traceSourceDatabaseName: string;
  traceSourceName: string;
  traceSourceTableName: string;
  traceSourceHighlightedTraceAttributes?: TTraceSource['highlightedTraceAttributeExpressions'];
  traceSourceMaterializedViews?: TTraceSource['materializedViews'];
}) {
  const hasLogSource =
    logSourceDatabaseName && logSourceName && logSourceTableName;
  const hasMetricsSource = metricsSourceDatabaseName && metricsSourceName;

  let logSource: TLogSource | undefined;
  if (hasLogSource) {
    const newSource = await createSourceMutation.mutateAsync({
      source: {
        kind: SourceKind.Log,
        name: logSourceName,
        connection: connectionId,
        from: {
          databaseName: logSourceDatabaseName,
          tableName: logSourceTableName,
        },
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
      },
    });
    if (isLogSource(newSource)) {
      logSource = newSource;
    }
  }
  const traceSource = await createSourceMutation.mutateAsync({
    source: {
      kind: SourceKind.Trace,
      name: traceSourceName,
      connection: connectionId,
      from: {
        databaseName: traceSourceDatabaseName,
        tableName: traceSourceTableName,
      },
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
      ...(hasLogSource ? { logSourceId: 'l-758211293' } : {}),
      statusCodeExpression: 'StatusCode',
      statusMessageExpression: 'StatusMessage',
      spanEventsValueExpression: 'Events',
      highlightedTraceAttributeExpressions:
        traceSourceHighlightedTraceAttributes,
      materializedViews: traceSourceMaterializedViews,
    },
  });
  if (!isTraceSource(traceSource)) {
    // Should be impossible
    throw new Error('Source that is not trace was somehow created');
  }
  let metricsSource: TSource | undefined;
  if (hasMetricsSource) {
    metricsSource = await createSourceMutation.mutateAsync({
      source: {
        kind: SourceKind.Metric,
        name: metricsSourceName,
        connection: connectionId,
        from: {
          databaseName: metricsSourceDatabaseName,
          tableName: '',
        },
        timestampValueExpression: 'TimeUnix',
        serviceNameExpression: 'ServiceName',
        metricTables: {
          [MetricsDataType.Gauge]: 'otel_metrics_gauge',
          [MetricsDataType.Histogram]: 'otel_metrics_histogram',
          [MetricsDataType.Sum]: 'otel_metrics_sum',
          [MetricsDataType.Summary]: 'otel_metrics_summary',
          [MetricsDataType.ExponentialHistogram]:
            'otel_metrics_exponential_histogram',
        },
        resourceAttributesExpression: 'ResourceAttributes',
        ...(hasLogSource && logSource ? { logSourceId: logSource.id } : {}),
      },
    });
  }
  const sessionSource = await createSourceMutation.mutateAsync({
    source: {
      kind: SourceKind.Session,
      name: sessionSourceName,
      connection: connectionId,
      from: {
        databaseName: sessionSourceDatabaseName,
        tableName: sessionSourceTableName,
      },
      timestampValueExpression: 'TimestampTime',
      resourceAttributesExpression: 'ResourceAttributes',
      traceSourceId: traceSource.id,
    },
  });
  await Promise.all([
    ...(hasLogSource && logSource
      ? [
          updateSourceMutation.mutateAsync({
            source: {
              ...logSource,
              traceSourceId: traceSource.id,
              ...(hasMetricsSource && metricsSource
                ? { metricSourceId: metricsSource.id }
                : {}),
            },
          }),
        ]
      : []),
    updateSourceMutation.mutateAsync({
      source: {
        ...traceSource,
        ...(hasLogSource && logSource ? { logSourceId: logSource.id } : {}),
        ...(hasMetricsSource && metricsSource
          ? { metricSourceId: metricsSource.id }
          : {}),
        sessionSourceId: sessionSource.id,
      },
    }),
  ]);
}

/**
 * Connects to the public ClickStack demo server and provisions the demo and
 * ClickPy sources. No-op for ClickHouse builds. Shared by the onboarding modal
 * and the getting-started page.
 */
export function useConnectToDemoServer({
  brandName,
  onSuccess,
}: {
  brandName: string;
  onSuccess?: () => void;
}) {
  const { data: sources } = useSources();
  const { data: connections } = useConnections();
  const createSourceMutation = useCreateSource();
  const createConnectionMutation = useCreateConnection();
  const updateSourceMutation = useUpdateSource();
  const deleteSourceMutation = useDeleteSource();
  const [isConnecting, setIsConnecting] = useState(false);

  const connectToDemoServer = useCallback(async () => {
    if (IS_CLICKHOUSE_BUILD) return;
    setIsConnecting(true);
    try {
      if (sources) {
        for (const source of sources) {
          // Clean out ALL existing demo and ClickPy sources to avoid duplicates
          if (
            source.name.startsWith('Demo') ||
            source.name.startsWith('ClickPy')
          ) {
            await deleteSourceMutation.mutateAsync({
              id: source.id,
            });
          }
        }
      }
      // Reuse existing demo connection if available, otherwise create one
      const existingDemoConnection = connections?.find(c => c.name === 'Demo');
      let createdConnectionId = existingDemoConnection?.id ?? '';
      if (!existingDemoConnection) {
        await createConnectionMutation.mutateAsync(
          {
            connection: {
              name: 'Demo',
              host: 'https://sql-clickhouse.clickhouse.com',
              username: 'otel_demo',
              password: '',
            },
          },
          {
            onSuccess(data) {
              createdConnectionId = data.id;
            },
            onError(error) {
              console.error('Failed to create demo connection: ', error);
            },
          },
        );
      }

      await addOtelDemoSources({
        connectionId: createdConnectionId,
        createConnectionMutation,
        createSourceMutation,
        deleteSourceMutation,

        logSourceDatabaseName: 'otel_v2',
        logSourceName: 'Demo Logs',
        logSourceTableName: 'otel_logs',

        metricsSourceDatabaseName: 'otel_v2',
        metricsSourceName: 'Demo Metrics',

        sessionSourceDatabaseName: 'otel_v2',
        sessionSourceName: 'Demo Sessions',
        sessionSourceTableName: 'hyperdx_sessions',

        traceSourceDatabaseName: 'otel_v2',
        traceSourceName: 'Demo Traces',
        traceSourceTableName: 'otel_traces',
        traceSourceMaterializedViews: [
          {
            databaseName: 'otel_v2',
            tableName: 'otel_traces_1m',
            dimensionColumns: 'ServiceName, StatusCode',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              { mvColumn: 'count', aggFn: 'count', sourceColumn: '' },
              {
                mvColumn: 'max__Duration',
                aggFn: 'max',
                sourceColumn: 'Duration',
              },
              {
                mvColumn: 'avg__Duration',
                aggFn: 'avg',
                sourceColumn: 'Duration',
              },
            ],
          },
          {
            databaseName: 'otel_v2',
            tableName: 'otel_traces_1m_v2',
            dimensionColumns: 'ServiceName, SpanName, SpanKind',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              { mvColumn: 'count', aggFn: 'count', sourceColumn: '' },
              {
                mvColumn: 'max__Duration',
                aggFn: 'max',
                sourceColumn: 'Duration',
              },
              {
                mvColumn: 'avg__Duration',
                aggFn: 'avg',
                sourceColumn: 'Duration',
              },
              {
                mvColumn: 'quantile__Duration',
                aggFn: 'quantile',
                sourceColumn: 'Duration',
              },
            ],
          },
        ],

        updateSourceMutation,
      });

      // ClickPy demo sources
      await addOtelDemoSources({
        connectionId: createdConnectionId,
        createConnectionMutation,
        createSourceMutation,
        deleteSourceMutation,

        sessionSourceDatabaseName: 'otel_clickpy',
        sessionSourceName: 'ClickPy Sessions',
        sessionSourceTableName: 'hyperdx_sessions',

        traceSourceDatabaseName: 'otel_clickpy',
        traceSourceName: 'ClickPy Traces',
        traceSourceTableName: 'otel_traces',
        traceSourceHighlightedTraceAttributes: [
          {
            sqlExpression:
              "if((SpanAttributes['http.route']) LIKE '%dashboard%', concat('https://clickpy.clickhouse.com', path(SpanAttributes['http.target'])), '')",
            alias: 'clickpy_link',
          },
        ],

        updateSourceMutation,
      });

      notifications.show({
        title: 'Success',
        message: `Connected to ${brandName} demo server.`,
      });
      onSuccess?.();
    } catch (err) {
      console.error(err);
      notifications.show({
        color: 'red',
        title: 'Error',
        message: `Could not connect to the ${brandName} demo server, please try again later.`,
      });
    } finally {
      setIsConnecting(false);
    }
  }, [
    brandName,
    connections,
    createSourceMutation,
    createConnectionMutation,
    updateSourceMutation,
    deleteSourceMutation,
    sources,
    onSuccess,
  ]);

  return { connectToDemoServer, isConnecting };
}

/**
 * For ClickHouse builds: attempt to auto-connect to the origin ClickHouse
 * server using default credentials. Runs once while `enabled` and no
 * connection exists yet. No-op for non-ClickHouse builds.
 */
export function useAutoConnectClickHouse({
  enabled,
  onConnected,
}: {
  enabled: boolean;
  onConnected?: () => void;
}) {
  const { data: connections } = useConnections();
  const createConnectionMutation = useCreateConnection();
  const [hasAttempted, setHasAttempted] = useState(false);

  useEffect(() => {
    if (!IS_CLICKHOUSE_BUILD) return;
    if (!enabled) return;
    if (connections?.length !== 0) return;
    if (hasAttempted) return;
    // lets try to auto connect to the origin clickhouse server
    setHasAttempted(true);
    const host = window.location.origin;
    const client = new ClickhouseClient({
      host,
      username: 'default',
      password: '',
    });
    client
      .query({ query: 'SELECT 1', shouldSkipApplySettings: true })
      .then(result => {
        result.json().then(() => {
          createConnectionMutation.mutate(
            {
              connection: {
                name: 'Default',
                host,
                username: 'default',
                password: '',
              },
            },
            {
              onSuccess: () => {
                onConnected?.();
              },
            },
          );
        });
      })
      .catch(() => {
        // Auto-connect failed, user will use the form manually
      });
  }, [
    enabled,
    connections,
    hasAttempted,
    createConnectionMutation,
    onConnected,
  ]);
}
