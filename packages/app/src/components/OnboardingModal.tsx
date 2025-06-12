import { useCallback, useEffect, useState } from 'react';
import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_LOCAL_MODE } from '@/config';
import { useConnections, useCreateConnection } from '@/connection';
import { useCreateSource, useSources, useUpdateSource } from '@/source';

import { TableSourceForm } from './SourceForm';

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

  const handleDemoServerClick = useCallback(async () => {
    try {
      await createConnectionMutation.mutateAsync({
        connection: {
          id: 'local',
          name: 'Demo',
          host: 'https://sql-clickhouse.clickhouse.com',
          username: 'otel_demo',
          password: '',
        },
      });
      const logSource = await createSourceMutation.mutateAsync({
        source: {
          kind: SourceKind.Log,
          name: 'Demo Logs',
          connection: 'local',
          from: {
            databaseName: 'otel_v2',
            tableName: 'otel_logs',
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
      const traceSource = await createSourceMutation.mutateAsync({
        source: {
          kind: SourceKind.Trace,
          name: 'Demo Traces',
          connection: 'local',
          from: {
            databaseName: 'otel_v2',
            tableName: 'otel_traces',
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
          logSourceId: 'l-758211293',
          statusCodeExpression: 'StatusCode',
          statusMessageExpression: 'StatusMessage',
          spanEventsValueExpression: 'Events',
        },
      });
      const metricsSource = await createSourceMutation.mutateAsync({
        source: {
          kind: SourceKind.Metric,
          name: 'Demo Metrics',
          connection: 'local',
          from: {
            databaseName: 'otel_v2',
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
          logSourceId: logSource.id,
        },
      });
      const sessionSource = await createSourceMutation.mutateAsync({
        source: {
          kind: SourceKind.Session,
          name: 'Demo Sessions',
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
          traceSourceId: traceSource.id,
          traceIdExpression: 'TraceId',
          spanIdExpression: 'SpanId',
          implicitColumnExpression: 'Body',
        },
      });
      await Promise.all([
        updateSourceMutation.mutateAsync({
          source: {
            ...logSource,
            sessionSourceId: sessionSource.id,
            traceSourceId: traceSource.id,
            metricSourceId: metricsSource.id,
          },
        }),
        updateSourceMutation.mutateAsync({
          source: {
            ...traceSource,
            logSourceId: logSource.id,
            sessionSourceId: sessionSource.id,
            metricSourceId: metricsSource.id,
          },
        }),
      ]);
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
  }, [createSourceMutation, createConnectionMutation, updateSourceMutation]);

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
