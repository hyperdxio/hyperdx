import { useEffect, useState } from 'react';
import { Button, Divider, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_LOCAL_MODE } from '@/config';
import { useConnections, useCreateConnection } from '@/connection';
import { useCreateSource, useSources } from '@/source';

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
            onClick={async () => {
              try {
                await createConnectionMutation.mutateAsync({
                  connection: {
                    id: 'local',
                    name: 'Demo',
                    host: 'https://demo-ch.hyperdx.io',
                    username: 'demo',
                    password: 'demo',
                  },
                });
                const traceSource = await createSourceMutation.mutateAsync({
                  source: {
                    kind: 'trace',
                    name: 'Demo Traces',
                    connection: 'local',
                    from: {
                      databaseName: 'default',
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
                  },
                });
                await createSourceMutation.mutateAsync({
                  source: {
                    kind: 'log',
                    name: 'Demo Logs',
                    connection: 'local',
                    from: {
                      databaseName: 'default',
                      tableName: 'otel_logs',
                    },
                    timestampValueExpression: 'TimestampTime',
                    defaultTableSelectExpression:
                      'Timestamp, ServiceName, SeverityText, Body',
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
            }}
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
