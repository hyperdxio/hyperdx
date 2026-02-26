import { memo, useCallback, useEffect, useState } from 'react';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import {
  MetricsDataType,
  MetricTable,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Flex, Loader, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft } from '@tabler/icons-react';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_CLICKHOUSE_BUILD, IS_LOCAL_MODE } from '@/config';
import { useConnections, useCreateConnection } from '@/connection';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import {
  inferTableSourceConfig,
  useCreateSource,
  useDeleteSource,
  useSources,
  useUpdateSource,
} from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import { TableSourceForm } from './Sources/SourceForm';
import { SourcesList } from './Sources/SourcesList';

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
  traceSourceHighlightedTraceAttributes?: TSource['highlightedTraceAttributeExpressions'];
  traceSourceMaterializedViews?: TSource['materializedViews'];
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
      highlightedTraceAttributeExpressions:
        traceSourceHighlightedTraceAttributes,
      materializedViews: traceSourceMaterializedViews,
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

function OnboardingModalComponent({
  requireSource = true,
}: {
  requireSource?: boolean;
}) {
  const brandName = useBrandDisplayName();
  const { data: sources } = useSources();
  const { data: connections } = useConnections();

  const startStep =
    connections?.length === 0
      ? 'connection'
      : sources?.length === 0 && requireSource
        ? 'auto-detect'
        : undefined;

  const [_step, setStep] = useState<
    'connection' | 'auto-detect' | 'source' | 'closed' | undefined
  >(undefined);

  const step = _step;

  useEffect(() => {
    if (startStep != null && step == null) {
      setStep(startStep);
    }
  }, [startStep, step]);

  const createSourceMutation = useCreateSource();
  const createConnectionMutation = useCreateConnection();
  const updateSourceMutation = useUpdateSource();
  const deleteSourceMutation = useDeleteSource();
  const metadata = useMetadataWithSettings();

  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  // We should only try to auto-detect once
  const [hasAutodetected, setHasAutodetected] = useState(false);
  const [autoDetectedSources, setAutoDetectedSources] = useState<TSource[]>([]);

  // Auto-connect for clickstack build: test default credentials against origin
  const [hasAttemptedAutoConnect, setHasAttemptedAutoConnect] = useState(false);
  useEffect(() => {
    if (!IS_CLICKHOUSE_BUILD) return;
    if (step !== 'connection') return;
    if (connections?.length !== 0) return;
    if (hasAttemptedAutoConnect) return;
    // lets try to auto connect to the origin clickhouse server
    setHasAttemptedAutoConnect(true);
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
                setStep('auto-detect');
              },
            },
          );
        });
      })
      .catch(() => {
        // Auto-connect failed, user will use the form manually
      });
  }, [step, connections, hasAttemptedAutoConnect, createConnectionMutation]);

  const handleAutoDetectSources = useCallback(
    async (connectionId: string) => {
      try {
        setIsAutoDetecting(true);
        setHasAutodetected(true);

        // Try to detect OTEL tables
        const otelTables = await metadata.getOtelTables({ connectionId });

        if (!otelTables) {
          // No tables detected, go to manual source setup
          setStep('source');
          return;
        }

        const createdSources: TSource[] = [];

        // Create Log Source if available
        if (otelTables.tables.logs) {
          const inferredConfig = await inferTableSourceConfig({
            databaseName: otelTables.database,
            tableName: otelTables.tables.logs,
            connectionId,
            metadata,
          });

          if (inferredConfig.timestampValueExpression != null) {
            const logSource = await createSourceMutation.mutateAsync({
              source: {
                kind: SourceKind.Log,
                name: 'Logs',
                connection: connectionId,
                from: {
                  databaseName: otelTables.database,
                  tableName: otelTables.tables.logs,
                },
                ...inferredConfig,
                timestampValueExpression:
                  inferredConfig.timestampValueExpression,
              },
            });
            createdSources.push(logSource);
          } else {
            console.error(
              'Log source was found but missing required fields',
              inferredConfig,
            );
          }
        }

        // Create Trace Source if available
        if (otelTables.tables.traces) {
          const inferredConfig = await inferTableSourceConfig({
            databaseName: otelTables.database,
            tableName: otelTables.tables.traces,
            connectionId,
            metadata,
          });

          if (inferredConfig.timestampValueExpression != null) {
            const traceSource = await createSourceMutation.mutateAsync({
              source: {
                kind: SourceKind.Trace,
                name: 'Traces',
                connection: connectionId,
                from: {
                  databaseName: otelTables.database,
                  tableName: otelTables.tables.traces,
                },
                ...inferredConfig,
                // Help typescript understand it's not null
                timestampValueExpression:
                  inferredConfig.timestampValueExpression,
              },
            });
            createdSources.push(traceSource);
          } else {
            console.error(
              'Trace source was found but missing required fields',
              inferredConfig,
            );
          }
        }

        // Create Metrics Source if any metrics tables are available
        const hasMetrics = Object.values(otelTables.tables.metrics).some(
          t => t != null,
        );
        if (hasMetrics) {
          const metricTables: MetricTable = {
            [MetricsDataType.Gauge]: '',
            [MetricsDataType.Histogram]: '',
            [MetricsDataType.Sum]: '',
            [MetricsDataType.Summary]: '',
            [MetricsDataType.ExponentialHistogram]: '',
          };
          if (otelTables.tables.metrics.gauge) {
            metricTables[MetricsDataType.Gauge] =
              otelTables.tables.metrics.gauge;
          }
          if (otelTables.tables.metrics.histogram) {
            metricTables[MetricsDataType.Histogram] =
              otelTables.tables.metrics.histogram;
          }
          if (otelTables.tables.metrics.sum) {
            metricTables[MetricsDataType.Sum] = otelTables.tables.metrics.sum;
          }
          if (otelTables.tables.metrics.summary) {
            metricTables[MetricsDataType.Summary] =
              otelTables.tables.metrics.summary;
          }
          if (otelTables.tables.metrics.expHistogram) {
            metricTables[MetricsDataType.ExponentialHistogram] =
              otelTables.tables.metrics.expHistogram;
          }

          const metricsSource = await createSourceMutation.mutateAsync({
            source: {
              kind: SourceKind.Metric,
              name: 'Metrics',
              connection: connectionId,
              from: {
                databaseName: otelTables.database,
                tableName: '',
              },
              timestampValueExpression: 'TimeUnix',
              serviceNameExpression: 'ServiceName',
              metricTables,
              resourceAttributesExpression: 'ResourceAttributes',
            },
          });
          createdSources.push(metricsSource);
        }

        // Create Session Source if available
        if (otelTables.tables.sessions) {
          const inferredConfig = await inferTableSourceConfig({
            databaseName: otelTables.database,
            tableName: otelTables.tables.sessions,
            connectionId,
            metadata,
          });
          const traceSource = createdSources.find(
            s => s.kind === SourceKind.Trace,
          );

          if (
            inferredConfig.timestampValueExpression != null &&
            traceSource != null
          ) {
            const sessionSource = await createSourceMutation.mutateAsync({
              source: {
                kind: SourceKind.Session,
                name: 'Sessions',
                connection: connectionId,
                from: {
                  databaseName: otelTables.database,
                  tableName: otelTables.tables.sessions,
                },
                ...inferredConfig,
                timestampValueExpression:
                  inferredConfig.timestampValueExpression,
                traceSourceId: traceSource.id, // this is required for session source creation
              },
            });
            createdSources.push(sessionSource);
          } else {
            console.error(
              'Session source was found but missing required fields',
              inferredConfig,
            );
          }
        }

        if (createdSources.length === 0) {
          console.error('No sources created due to missing required fields');
          // No sources created, go to manual source setup
          setStep('source');
          return;
        }

        // Update sources to link them together
        const logSource = createdSources.find(s => s.kind === SourceKind.Log);
        const traceSource = createdSources.find(
          s => s.kind === SourceKind.Trace,
        );
        const metricsSource = createdSources.find(
          s => s.kind === SourceKind.Metric,
        );
        const sessionSource = createdSources.find(
          s => s.kind === SourceKind.Session,
        );

        const updatePromises = [];

        if (logSource) {
          updatePromises.push(
            updateSourceMutation.mutateAsync({
              source: {
                ...logSource,
                ...(traceSource ? { traceSourceId: traceSource.id } : {}),
                ...(metricsSource ? { metricSourceId: metricsSource.id } : {}),
                ...(sessionSource ? { sessionSourceId: sessionSource.id } : {}),
              },
            }),
          );
        }

        if (traceSource) {
          updatePromises.push(
            updateSourceMutation.mutateAsync({
              source: {
                ...traceSource,
                ...(logSource ? { logSourceId: logSource.id } : {}),
                ...(metricsSource ? { metricSourceId: metricsSource.id } : {}),
                ...(sessionSource ? { sessionSourceId: sessionSource.id } : {}),
              },
            }),
          );
        }

        await Promise.all(updatePromises);

        setAutoDetectedSources(createdSources);
        notifications.show({
          title: 'Success',
          message: `Automatically detected and created ${createdSources.length} source${createdSources.length > 1 ? 's' : ''}.`,
        });
        setStep('closed');
      } catch (err) {
        console.error('Error auto-detecting sources:', err);
        notifications.show({
          color: 'red',
          title: 'Error',
          message:
            'Failed to auto-detect telemetry sources. Please set up manually.',
        });
        // Fall back to manual source setup
        setStep('source');
      } finally {
        setIsAutoDetecting(false);
      }
    },
    [
      metadata,
      createSourceMutation,
      updateSourceMutation,
      setStep,
      setAutoDetectedSources,
    ],
  );

  // Trigger auto-detection when entering the auto-detect step
  useEffect(() => {
    if (
      step === 'auto-detect' && // we should be trying to auto detect
      sources?.length === 0 && // no sources yet
      connections && // we need connections
      connections.length > 0 &&
      isAutoDetecting === false && // make sure we aren't currently auto detecting
      hasAutodetected === false // only call it once
    ) {
      handleAutoDetectSources(connections[0].id);
    }
  }, [
    step,
    connections,
    handleAutoDetectSources,
    isAutoDetecting,
    sources,
    hasAutodetected,
  ]);

  const handleDemoServerClick = useCallback(async () => {
    if (IS_CLICKHOUSE_BUILD) return;
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
      setStep('closed');
    } catch (err) {
      console.error(err);
      notifications.show({
        color: 'red',
        title: 'Error',
        message: `Could not connect to the ${brandName} demo server, please try again later.`,
      });
    }
  }, [
    brandName,
    createSourceMutation,
    createConnectionMutation,
    updateSourceMutation,
    deleteSourceMutation,
    sources,
  ]);

  return (
    <Modal
      data-testid="onboarding-modal"
      opened={step != null && step !== 'closed'}
      onClose={() => {}}
      title={`Welcome to ${brandName}`}
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
                host: IS_CLICKHOUSE_BUILD
                  ? window.location.origin
                  : 'http://localhost:8123',
                username: 'default',
                password: '',
              }}
              onSave={() => {
                if (hasAutodetected) {
                  setStep('source');
                } else {
                  setStep('auto-detect');
                }
              }}
              isNew={true}
            />
          ) : (
            <ConnectionForm
              connection={connections[0]}
              isNew={false}
              onSave={() => {
                // If we've already auto-detected, just go to manual source setup
                if (hasAutodetected) {
                  setStep('source');
                } else {
                  setStep('auto-detect');
                }
              }}
              showCancelButton={false}
              showDeleteButton={false}
            />
          )}
          {!IS_LOCAL_MODE && (
            <Text size="xs" mt="md">
              You can always add and edit connections later.
            </Text>
          )}
          {!IS_CLICKHOUSE_BUILD && (
            <>
              <Divider label="OR" my="md" />
              <Button
                data-testid="demo-server-button"
                variant="secondary"
                w="100%"
                onClick={handleDemoServerClick}
              >
                Connect to Demo Server
              </Button>
            </>
          )}
        </>
      )}
      {step === 'auto-detect' && (
        <>
          {isAutoDetecting ? (
            <>
              <Flex justify="center" align="center" direction="column" py="xl">
                <Loader size="md" mb="md" />
                <Text size="sm" c="dimmed" mb="md">
                  Detecting available tables...
                </Text>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => {
                    setIsAutoDetecting(false);
                    setStep('source');
                  }}
                >
                  Skip and setup manually
                </Button>
              </Flex>
            </>
          ) : autoDetectedSources.length > 0 ? (
            <>
              <Button
                variant="subtle"
                onClick={() => setStep('connection')}
                p="xs"
                mb="md"
              >
                <IconArrowLeft size={14} className="me-2" /> Back
              </Button>
              <Text size="sm" mb="md">
                We automatically detected and created{' '}
                {autoDetectedSources.length} source
                {autoDetectedSources.length > 1 ? 's' : ''} from your
                connection. You can review, edit, or continue.
              </Text>
              <SourcesList
                withCard={false}
                variant="default"
                showEmptyState={false}
              />
              <Flex justify="space-between" mt="md">
                <Button
                  variant="subtle"
                  onClick={() => {
                    setStep('source');
                  }}
                >
                  Add more sources
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setStep('closed');
                  }}
                >
                  Continue
                </Button>
              </Flex>
            </>
          ) : (
            <Flex justify="center" align="center" direction="column" py="xl">
              {/* We don't expect users to hit this - but this allows them to get unstuck if they do */}
              <Text size="sm" c="dimmed" mb="md">
                No OTel tables detected automatically, please setup sources
                manually.
              </Text>
              <Button
                variant="primary"
                onClick={() => {
                  setStep('source');
                }}
              >
                Continue
              </Button>
            </Flex>
          )}
        </>
      )}
      {step === 'source' && (
        <>
          <Button
            variant="subtle"
            onClick={() => setStep('connection')}
            p="xs"
            mb="md"
          >
            <IconArrowLeft size={14} className="me-2" /> Back
          </Button>
          <Text size="sm" mb="md">
            Lets set up a source table to query telemetry from.
          </Text>
          <TableSourceForm
            isNew
            defaultName="Logs"
            onCreate={() => {
              setStep('closed');
            }}
          />
          <Text size="xs" mt="lg">
            You can always add and edit sources later.
          </Text>
        </>
      )}
    </Modal>
  );
}
const OnboardingModal = memo(OnboardingModalComponent);
export default OnboardingModal;
