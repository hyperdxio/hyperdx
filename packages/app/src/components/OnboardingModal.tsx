import { useCallback, useEffect, useState } from 'react';
import {
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_LOCAL_MODE } from '@/config';
import { useConnections, useCreateConnection } from '@/connection';
import {
  useCreateSource,
  useDeleteSource,
  useSources,
  useUpdateSource,
} from '@/source';

import { TableSourceForm } from './SourceForm';

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
}) {
  const hasLogSource =
    logSourceDatabaseName && logSourceName && logSourceTableName;
  const hasMetricsSource = metricsSourceDatabaseName && metricsSourceName;

  let logSource: TSource | undefined;
  if (hasLogSource) {
    logSource = await createSourceMutation.mutateAsync({
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
    },
  });
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
      defaultTableSelectExpression: 'Timestamp, ServiceName, Body',
      serviceNameExpression: 'ServiceName',
      severityTextExpression: 'SeverityText',
      eventAttributesExpression: 'LogAttributes',
      resourceAttributesExpression: 'ResourceAttributes',
      traceSourceId: traceSource.id,
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      implicitColumnExpression: 'Body',
    },
  });
  await Promise.all([
    ...(hasLogSource && logSource
      ? [
          updateSourceMutation.mutateAsync({
            source: {
              ...logSource,
              sessionSourceId: sessionSource.id,
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

export default function OnboardingModal({
  requireSource = true,
}: {
  requireSource?: boolean;
}) {
  const { data: sources } = useSources();
  const { data: connections } = useConnections();

  const startStep =
    connections?.length === 0
      ? 'connection'
      : sources?.length === 0 && requireSource
        ? 'source'
        : undefined;

  const [_step, setStep] = useState<'connection' | 'source' | undefined>(
    undefined,
  );

  const step = _step ?? startStep;

  useEffect(() => {
    if (step === 'source' && sources != null && sources.length > 0) {
      setStep(undefined);
    }
  }, [step, sources]);

  const createSourceMutation = useCreateSource();
  const createConnectionMutation = useCreateConnection();
  const updateSourceMutation = useUpdateSource();
  const deleteSourceMutation = useDeleteSource();

  const handleDemoServerClick = useCallback(async () => {
    try {
      if (sources) {
        for (const source of sources) {
          // Clean out old demo sources. All new ones use the otel_v2 database
          if (
            source.connection === 'local' &&
            source.name.startsWith('Demo') &&
            source.from.databaseName !== 'otel_v2'
          ) {
            await deleteSourceMutation.mutateAsync({
              id: source.id,
            });
          }
        }
      }
      let createdConnectionId = '';
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
            return;
          },
        },
      );

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

        updateSourceMutation,
      });

      notifications.show({
        title: 'Success',
        message: 'Connected to HyperDX demo server.',
      });
      setStep(undefined);
    } catch (err) {
      console.error(err);
      notifications.show({
        color: 'red',
        title: 'Error',
        message:
          'Could not connect to the HyperDX demo server, please try again later.',
      });
    }
  }, [
    createSourceMutation,
    createConnectionMutation,
    updateSourceMutation,
    deleteSourceMutation,
    sources,
  ]);

  return (
    <Modal
      opened={step != null}
      onClose={() => {}}
      title="Welcome to HyperDX"
      size="xl"
      withCloseButton={false}
    >
      {step === 'connection' && connections != null && (
        <>
          <Text size="sm" mb="md">
            Lets set up your connection to ClickHouse
          </Text>
          {connections.length === 0 ? (
            <ConnectionForm
              connection={{
                id: '',
                name: 'Default',
                host: 'http://localhost:8123',
                username: 'default',
                password: '',
              }}
              onSave={() => {
                setStep('source');
              }}
              isNew={true}
            />
          ) : (
            <ConnectionForm
              connection={connections[0]}
              isNew={false}
              onSave={() => {
                setStep('source');
              }}
              showCancelButton={false}
              showDeleteButton={false}
            />
          )}
          {!IS_LOCAL_MODE && (
            <Text size="xs" mt="md" c="gray.4">
              You can always add and edit connections later.
            </Text>
          )}
          <Divider label="OR" my="md" />
          <Button
            variant="outline"
            w="100%"
            color="gray.4"
            onClick={handleDemoServerClick}
          >
            Connect to Demo Server
          </Button>
        </>
      )}
      {step === 'source' && (
        <>
          <Button
            variant="subtle"
            color="gray.4"
            onClick={() => setStep('connection')}
            p="xs"
            mb="md"
          >
            <i className="bi bi-arrow-left me-2" /> Back
          </Button>
          <Text size="sm" mb="md">
            Lets set up a source table to query telemetry from.
          </Text>
          <TableSourceForm
            isNew
            defaultName="Logs"
            onCreate={() => {
              setStep(undefined);
            }}
          />
          <Text size="xs" mt="lg" c="gray.4">
            You can always add and edit sources later.
          </Text>
        </>
      )}
    </Modal>
  );
}
