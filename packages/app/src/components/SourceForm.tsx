import React, { useCallback, useEffect, useState } from 'react';
import {
  Control,
  Controller,
  useForm,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import { z } from 'zod';
import {
  MetricsDataType,
  SourceKind,
  sourceSchemaWithout,
  TSource,
  TSourceUnion,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Radio,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { IS_METRICS_ENABLED, IS_SESSIONS_ENABLED } from '@/config';
import { useConnections } from '@/connection';
import {
  inferTableSourceConfig,
  isValidMetricTable,
  isValidSessionsTable,
  useCreateSource,
  useDeleteSource,
  useSource,
  useSources,
  useUpdateSource,
} from '@/source';

import ConfirmDeleteMenu from './ConfirmDeleteMenu';
import { ConnectionSelectControlled } from './ConnectionSelect';
import { DatabaseSelectControlled } from './DatabaseSelect';
import { DBTableSelectControlled } from './DBTableSelect';
import { InputControlled } from './InputControlled';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

const DEFAULT_DATABASE = 'default';

// TODO: maybe otel clickhouse export migrate the schema?
const OTEL_CLICKHOUSE_EXPRESSIONS = {
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
};

const CORRELATION_FIELD_MAP: Record<
  SourceKind,
  Record<string, { targetKind: SourceKind; targetField: keyof TSource }[]>
> = {
  [SourceKind.Log]: {
    metricSourceId: [
      { targetKind: SourceKind.Metric, targetField: 'logSourceId' },
    ],
    traceSourceId: [
      { targetKind: SourceKind.Trace, targetField: 'logSourceId' },
    ],
  },
  [SourceKind.Trace]: {
    logSourceId: [{ targetKind: SourceKind.Log, targetField: 'traceSourceId' }],
    sessionSourceId: [
      { targetKind: SourceKind.Session, targetField: 'traceSourceId' },
    ],
    metricSourceId: [
      { targetKind: SourceKind.Metric, targetField: 'logSourceId' },
    ],
  },
  [SourceKind.Session]: {
    traceSourceId: [
      { targetKind: SourceKind.Trace, targetField: 'sessionSourceId' },
    ],
  },
  [SourceKind.Metric]: {
    logSourceId: [
      { targetKind: SourceKind.Log, targetField: 'metricSourceId' },
    ],
  },
};

function FormRow({
  label,
  children,
  helpText,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  helpText?: string;
}) {
  return (
    // <Group grow preventGrowOverflow={false}>
    <Flex align="center">
      <Stack
        justify="center"
        style={{
          maxWidth: 220,
          minWidth: 220,
          height: '36px',
        }}
      >
        {typeof label === 'string' ? (
          <Text tt="capitalize" c="gray.6" size="sm">
            {label}
          </Text>
        ) : (
          label
        )}
      </Stack>
      <Text
        c="gray.4"
        me="sm"
        style={{
          ...(!helpText ? { opacity: 0, pointerEvents: 'none' } : {}),
        }}
      >
        <Tooltip label={helpText} color="dark" c="white" multiline maw={600}>
          <i className="bi bi-question-circle cursor-pointer" />
        </Tooltip>
      </Text>
      <Box
        w="100%"
        style={{
          minWidth: 0,
        }}
      >
        {children}
      </Box>
    </Flex>
  );
}

// traceModel= ...
// logModel=....
// traceModel.logModel = 'custom'
// will pop open the custom trace model form as well
// need to make sure we don't recursively render them :joy:
// OR traceModel.logModel = 'log_id_blah'
// custom always points towards the url param

export function LogTableModelForm({ control, watch }: TableModelProps) {
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const tableName = watch(`from.tableName`);
  const connectionId = watch(`connection`);

  const [showOptionalFields, setShowOptionalFields] = useState(false);

  return (
    <>
      <Stack gap="sm">
        <FormRow
          label={'Timestamp Column'}
          helpText="DateTime column or expression that is part of your table's primary key."
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="timestampValueExpression"
            disableKeywordAutocomplete
          />
        </FormRow>
        <FormRow
          label={'Default Select'}
          helpText="Default columns selected in search results (this can be customized per search later)"
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="defaultTableSelectExpression"
            placeholder="Timestamp, Body"
          />
        </FormRow>
        <Box>
          {!showOptionalFields && (
            <Anchor
              underline="always"
              onClick={() => setShowOptionalFields(true)}
              size="xs"
              c="gray.4"
            >
              <Text me="sm" span>
                <i className="bi bi-gear" />
              </Text>
              Configure Optional Fields
            </Anchor>
          )}
          {showOptionalFields && (
            <Button
              onClick={() => setShowOptionalFields(false)}
              size="xs"
              variant="subtle"
              color="gray.4"
            >
              Hide Optional Fields
            </Button>
          )}
        </Box>
      </Stack>
      <Stack
        gap="sm"
        style={{
          display: showOptionalFields ? 'flex' : 'none',
        }}
      >
        <Divider />
        <FormRow label={'Service Name Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="serviceNameExpression"
            placeholder="ServiceName"
          />
        </FormRow>
        <FormRow label={'Log Level Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="severityTextExpression"
            placeholder="SeverityText"
          />
        </FormRow>
        <FormRow label={'Body Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="bodyExpression"
            placeholder="Body"
          />
        </FormRow>
        <FormRow label={'Log Attributes Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="eventAttributesExpression"
            placeholder="LogAttributes"
          />
        </FormRow>
        <FormRow label={'Resource Attributes Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="resourceAttributesExpression"
            placeholder="ResourceAttributes"
          />
        </FormRow>
        <FormRow
          label={'Displayed Timestamp Column'}
          helpText="This DateTime column is used to display search results."
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="displayedTimestampValueExpression"
            disableKeywordAutocomplete
          />
        </FormRow>
        <Divider />
        <FormRow
          label={'Correlated Metric Source'}
          helpText="HyperDX Source for metrics associated with logs. Optional"
        >
          <SourceSelectControlled control={control} name="metricSourceId" />
        </FormRow>
        <FormRow
          label={'Correlated Trace Source'}
          helpText="HyperDX Source for traces associated with logs. Optional"
        >
          <SourceSelectControlled control={control} name="traceSourceId" />
        </FormRow>

        <FormRow label={'Trace Id Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="traceIdExpression"
            placeholder="TraceId"
          />
        </FormRow>
        <FormRow label={'Span Id Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="spanIdExpression"
            placeholder="SpanId"
          />
        </FormRow>

        <Divider />
        {/* <FormRow
          label={'Unique Row ID Expression'}
          helpText="Unique identifier for a given row, will be primary key if not specified. Used for showing full row details in search results."
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="uniqueRowIdExpression"
            placeholder="Timestamp, ServiceName, Body"
          />
        </FormRow> */}
        {/* <FormRow label={'Table Filter Expression'}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="tableFilterExpression"
            placeholder="ServiceName = 'only_this_service'"
          />
        </FormRow> */}
        <FormRow
          label={'Implicit Column Expression'}
          helpText="Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log."
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="implicitColumnExpression"
            placeholder="Body"
          />
        </FormRow>
      </Stack>
    </>
  );
}

export function TraceTableModelForm({ control, watch }: TableModelProps) {
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const tableName = watch(`from.tableName`);
  const connectionId = watch(`connection`);

  return (
    <Stack gap="sm">
      <FormRow
        label={'Timestamp Column'}
        helpText="DateTime column or expression defines the start of the span"
      >
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="timestampValueExpression"
          placeholder="Timestamp"
          disableKeywordAutocomplete
        />
      </FormRow>
      <FormRow
        label={'Default Select'}
        helpText="Default columns selected in search results (this can be customized per search later)"
      >
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="defaultTableSelectExpression"
          placeholder="Timestamp, ServiceName, StatusCode, Duration, SpanName"
        />
      </FormRow>
      <Divider />
      <FormRow label={'Duration Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="durationExpression"
          placeholder="Duration Column"
        />
      </FormRow>
      <FormRow label={'Duration Precision'}>
        <Box mx="xl">
          <Controller
            control={control}
            name="durationPrecision"
            render={({ field: { onChange, value } }) => (
              <div style={{ width: '90%', marginBottom: 8 }}>
                <Slider
                  color="green"
                  defaultValue={0}
                  min={0}
                  max={9}
                  marks={[
                    { value: 0, label: 'Seconds' },
                    { value: 3, label: 'Millisecond' },
                    { value: 6, label: 'Microsecond' },
                    { value: 9, label: 'Nanosecond' },
                  ]}
                  value={value}
                  onChange={onChange}
                />
              </div>
            )}
          />
        </Box>
      </FormRow>
      <FormRow label={'Trace Id Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="traceIdExpression"
          placeholder="TraceId"
        />
      </FormRow>
      <FormRow label={'Span Id Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="spanIdExpression"
          placeholder="SpanId"
        />
      </FormRow>
      <FormRow label={'Parent Span Id Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="parentSpanIdExpression"
          placeholder="ParentSpanId"
        />
      </FormRow>
      <FormRow label={'Span Name Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="spanNameExpression"
          placeholder="SpanName"
        />
      </FormRow>
      <FormRow label={'Span Kind Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="spanKindExpression"
          placeholder="SpanKind"
        />
      </FormRow>
      <Divider />
      <FormRow
        label={'Correlated Log Source'}
        helpText="HyperDX Source for logs associated with traces. Optional"
      >
        <SourceSelectControlled control={control} name="logSourceId" />
      </FormRow>
      <FormRow
        label={'Correlated Session Source'}
        helpText="HyperDX Source for sessions associated with traces. Optional"
      >
        <SourceSelectControlled control={control} name="sessionSourceId" />
      </FormRow>
      <FormRow
        label={'Correlated Metric Source'}
        helpText="HyperDX Source for metrics associated with traces. Optional"
      >
        <SourceSelectControlled control={control} name="metricSourceId" />
      </FormRow>
      <FormRow label={'Status Code Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="statusCodeExpression"
          placeholder="StatusCode"
        />
      </FormRow>
      <FormRow label={'Status Message Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="statusMessageExpression"
          placeholder="StatusMessage"
        />
      </FormRow>
      <FormRow label={'Service Name Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="serviceNameExpression"
          placeholder="ServiceName"
        />
      </FormRow>
      <FormRow label={'Resource Attributes Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="resourceAttributesExpression"
          placeholder="ResourceAttributes"
        />
      </FormRow>
      <FormRow label={'Event Attributes Expression'}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="eventAttributesExpression"
          placeholder="SpanAttributes"
        />
      </FormRow>
      <FormRow
        label={'Span Events Expression'}
        helpText="Expression to extract span events. Used to capture events associated with spans. Expected to be Nested ( Timestamp DateTime64(9), Name LowCardinality(String), Attributes Map(LowCardinality(String), String)"
      >
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="spanEventsValueExpression"
          placeholder="Events"
        />
      </FormRow>
      <FormRow
        label={'Implicit Column Expression'}
        helpText="Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log."
      >
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="implicitColumnExpression"
          placeholder="SpanName"
        />
      </FormRow>
    </Stack>
  );
}

export function SessionTableModelForm({
  control,
  watch,
  setValue,
}: TableModelProps) {
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const connectionId = watch(`connection`);

  useEffect(() => {
    const { unsubscribe } = watch(async (value, { name, type }) => {
      try {
        const tableName = value.from?.tableName;
        if (tableName && name === 'from.tableName' && type === 'change') {
          const isValid = await isValidSessionsTable({
            databaseName,
            tableName,
            connectionId,
          });

          if (!isValid) {
            notifications.show({
              color: 'red',
              message: `${tableName} is not a valid Sessions schema.`,
            });
          }
        }
      } catch (e) {
        console.error(e);
        notifications.show({
          color: 'red',
          message: e.message,
        });
      }
    });

    return () => unsubscribe();
  }, [setValue, watch, databaseName, connectionId]);

  return (
    <>
      <Stack gap="sm">
        <FormRow
          label={'Correlated Trace Source'}
          helpText="HyperDX Source for traces associated with sessions. Required"
        >
          <SourceSelectControlled control={control} name="traceSourceId" />
        </FormRow>
      </Stack>
    </>
  );
}

interface TableModelProps {
  control: Control<TSourceUnion>;
  watch: UseFormWatch<TSourceUnion>;
  setValue: UseFormSetValue<TSourceUnion>;
}

export function MetricTableModelForm({
  control,
  watch,
  setValue,
}: TableModelProps) {
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const connectionId = watch(`connection`);

  useEffect(() => {
    for (const [_key, _value] of Object.entries(OTEL_CLICKHOUSE_EXPRESSIONS)) {
      setValue(_key as any, _value);
    }
    const { unsubscribe } = watch(async (value, { name, type }) => {
      try {
        if (name && type === 'change') {
          const [prefix, suffix] = name.split('.');
          if (prefix === 'metricTables') {
            const tableName =
              value.kind === SourceKind.Metric
                ? value?.metricTables?.[
                    suffix as keyof typeof value.metricTables
                  ]
                : '';
            const metricType = suffix as MetricsDataType;
            const isValid = await isValidMetricTable({
              databaseName,
              tableName,
              connectionId,
              metricType,
            });
            if (!isValid) {
              notifications.show({
                color: 'red',
                message: `${tableName} is not a valid OTEL ${metricType} schema.`,
              });
            }
          }
        }
      } catch (e) {
        console.error(e);
        notifications.show({
          color: 'red',
          message: e.message,
        });
      }
    });

    return () => unsubscribe();
  }, [setValue, watch, databaseName, connectionId]);

  return (
    <>
      <Stack gap="sm">
        {Object.values(MetricsDataType).map(metricType => (
          <FormRow
            key={metricType.toLowerCase()}
            label={`${metricType} Table`}
            helpText={
              metricType === MetricsDataType.ExponentialHistogram ||
              metricType === MetricsDataType.Summary
                ? `Table containing ${metricType.toLowerCase()} metrics data. Note: not yet fully supported by HyperDX`
                : `Table containing ${metricType.toLowerCase()} metrics data`
            }
          >
            <DBTableSelectControlled
              connectionId={connectionId}
              database={databaseName}
              control={control}
              name={`metricTables.${metricType.toLowerCase()}`}
            />
          </FormRow>
        ))}
        <FormRow
          label={'Correlated Log Source'}
          helpText="HyperDX Source for logs associated with metrics. Optional"
        >
          <SourceSelectControlled control={control} name="logSourceId" />
        </FormRow>
      </Stack>
    </>
  );
}

function TableModelForm({
  control,
  watch,
  setValue,
  kind,
}: {
  control: Control<TSourceUnion>;
  watch: UseFormWatch<TSourceUnion>;
  setValue: UseFormSetValue<TSourceUnion>;
  kind: SourceKind;
}) {
  switch (kind) {
    case SourceKind.Log:
      return (
        <LogTableModelForm
          control={control}
          watch={watch}
          setValue={setValue}
        />
      );
    case SourceKind.Trace:
      return (
        <TraceTableModelForm
          control={control}
          watch={watch}
          setValue={setValue}
        />
      );
    case SourceKind.Session:
      return (
        <SessionTableModelForm
          control={control}
          watch={watch}
          setValue={setValue}
        />
      );
    case SourceKind.Metric:
      return (
        <MetricTableModelForm
          control={control}
          watch={watch}
          setValue={setValue}
        />
      );
  }
}

export function TableSourceForm({
  sourceId,
  onSave,
  onCreate,
  isNew = false,
  defaultName,
  onCancel,
}: {
  sourceId?: string;
  onSave?: () => void;
  onCreate?: (source: TSource) => void;
  onCancel?: () => void;
  isNew?: boolean;
  defaultName?: string;
}) {
  const { data: source } = useSource({ id: sourceId });
  const { data: connections } = useConnections();

  const {
    watch,
    control,
    setValue,
    formState,
    handleSubmit,
    resetField,
    setError,
    clearErrors,
  } = useForm<TSourceUnion>({
    defaultValues: {
      kind: SourceKind.Log,
      name: defaultName,
      connection: connections?.[0]?.id,
      from: {
        databaseName: 'default',
        tableName: '',
      },
    },
    // TODO: HDX-1768 remove type assertion
    values: source as TSourceUnion,
    resetOptions: {
      keepDirtyValues: true,
      keepErrors: true,
    },
  });

  useEffect(() => {
    const { unsubscribe } = watch(async (_value, { name, type }) => {
      try {
        // TODO: HDX-1768 get rid of this type assertion
        const value = _value as TSourceUnion;
        if (
          value.connection != null &&
          value.from?.databaseName != null &&
          (value.kind === SourceKind.Metric || value.from.tableName != null) &&
          name === 'from.tableName' &&
          type === 'change'
        ) {
          const config = await inferTableSourceConfig({
            databaseName: value.from.databaseName,
            tableName:
              value.kind !== SourceKind.Metric ? value.from.tableName : '',
            connectionId: value.connection,
          });
          if (Object.keys(config).length > 0) {
            notifications.show({
              color: 'green',
              message:
                'Automatically inferred source configuration from table schema.',
            });
          }
          Object.entries(config).forEach(([key, value]) => {
            resetField(key as any, {
              keepDirty: true,
              defaultValue: value,
            });
          });
        }
      } catch (e) {
        console.error(e);
      }
    });

    return () => unsubscribe();
  }, [watch, resetField]);

  // Sets the default connection field to the first connection after the
  // connections have been loaded
  useEffect(() => {
    resetField('connection', { defaultValue: connections?.[0]?.id });
  }, [connections, resetField]);

  const kind: SourceKind = watch('kind');

  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();

  // Bidirectional source linking
  const { data: sources } = useSources();
  const currentSourceId = watch('id');

  useEffect(() => {
    const { unsubscribe } = watch(async (_value, { name, type }) => {
      const value = _value as TSourceUnion;
      if (!currentSourceId || !sources || type !== 'change') return;

      const correlationFields = CORRELATION_FIELD_MAP[kind];
      if (!correlationFields || !name || !(name in correlationFields)) return;

      const fieldName = name as keyof TSourceUnion;
      const newTargetSourceId = value[fieldName] as string | undefined;
      const targetConfigs = correlationFields[fieldName];

      for (const { targetKind, targetField } of targetConfigs) {
        // Find the previously linked source if any
        const previouslyLinkedSource = sources.find(
          s => s.kind === targetKind && s[targetField] === currentSourceId,
        );

        // If there was a previously linked source and it's different from the new one, unlink it
        if (
          previouslyLinkedSource &&
          previouslyLinkedSource.id !== newTargetSourceId
        ) {
          await updateSource.mutateAsync({
            source: {
              ...previouslyLinkedSource,
              [targetField]: undefined,
            } as TSource,
          });
        }

        // If a new source is selected, link it back
        if (newTargetSourceId) {
          const targetSource = sources.find(s => s.id === newTargetSourceId);
          if (targetSource && targetSource.kind === targetKind) {
            // Only update if the target field is empty to avoid overwriting existing correlations
            if (!targetSource[targetField]) {
              await updateSource.mutateAsync({
                source: {
                  ...targetSource,
                  [targetField]: currentSourceId,
                } as TSource,
              });
            }
          }
        }
      }
    });

    return () => unsubscribe();
  }, [watch, kind, currentSourceId, sources, updateSource]);

  const sourceFormSchema = sourceSchemaWithout({ id: true });
  const handleError = (error: z.ZodError<TSourceUnion>) => {
    const errors = error.errors;
    for (const err of errors) {
      const errorPath: string = err.path.join('.');
      // TODO: HDX-1768 get rid of this type assertion if possible
      setError(errorPath as any, { ...err });
    }
    notifications.show({
      color: 'red',
      message: (
        <Stack>
          <Text size="sm">
            <b>Failed to create source</b>
          </Text>
          {errors.map((err, i) => (
            <Text key={i} size="sm">
              ✖ {err.message}
            </Text>
          ))}
        </Stack>
      ),
    });
  };

  const _onCreate = useCallback(() => {
    clearErrors();
    handleSubmit(async data => {
      const parseResult = sourceFormSchema.safeParse(data);
      if (parseResult.error) {
        handleError(parseResult.error);
        return;
      }

      createSource.mutate(
        // TODO: HDX-1768 get rid of this type assertion
        { source: data as TSource },
        {
          onSuccess: async newSource => {
            // Handle bidirectional linking for new sources
            const correlationFields = CORRELATION_FIELD_MAP[newSource.kind];
            if (correlationFields && sources) {
              for (const [fieldName, targetConfigs] of Object.entries(
                correlationFields,
              )) {
                const targetSourceId = (newSource as any)[fieldName];
                if (targetSourceId) {
                  for (const { targetKind, targetField } of targetConfigs) {
                    const targetSource = sources.find(
                      s => s.id === targetSourceId,
                    );
                    if (targetSource && targetSource.kind === targetKind) {
                      // Only update if the target field is empty to avoid overwriting existing correlations
                      if (!targetSource[targetField]) {
                        await updateSource.mutateAsync({
                          source: {
                            ...targetSource,
                            [targetField]: newSource.id,
                          } as TSource,
                        });
                      }
                    }
                  }
                }
              }
            }

            onCreate?.(newSource);
            notifications.show({
              color: 'green',
              message: 'Source created',
            });
          },
          onError: error => {
            notifications.show({
              color: 'red',
              message: `Failed to create source - ${error.message}`,
            });
          },
        },
      );
    })();
  }, [
    handleSubmit,
    createSource,
    onCreate,
    kind,
    formState,
    sources,
    updateSource,
  ]);

  const _onSave = useCallback(() => {
    clearErrors();
    handleSubmit(data => {
      const parseResult = sourceFormSchema.safeParse(data);
      if (parseResult.error) {
        handleError(parseResult.error);
        return;
      }
      updateSource.mutate(
        // TODO: HDX-1768 get rid of this type assertion
        { source: data as TSource },
        {
          onSuccess: () => {
            onSave?.();
            notifications.show({
              color: 'green',
              message: 'Source updated',
            });
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message: 'Failed to update source',
            });
          },
        },
      );
    })();
  }, [handleSubmit, updateSource, onSave]);

  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const connectionId = watch(`connection`);

  return (
    <div
      style={
        {
          // maxWidth: 700
        }
      }
    >
      <Stack gap="md" mb="md">
        <Flex justify="space-between" align="center" mb="lg">
          <Text c="gray.4">Source Settings</Text>
          <Group>
            {onCancel && (
              <Button
                variant="outline"
                color="gray.4"
                onClick={onCancel}
                size="xs"
              >
                Cancel
              </Button>
            )}
            {isNew ? (
              <Button
                variant="outline"
                color="green"
                onClick={_onCreate}
                size="xs"
                loading={createSource.isPending}
              >
                Save New Source
              </Button>
            ) : (
              <>
                <ConfirmDeleteMenu
                  onDelete={() => deleteSource.mutate({ id: sourceId ?? '' })}
                />
                <Button
                  variant="outline"
                  color="green"
                  onClick={_onSave}
                  size="xs"
                  loading={createSource.isPending}
                >
                  Save Source
                </Button>
              </>
            )}
          </Group>
        </Flex>
        <FormRow label={'Name'}>
          <InputControlled
            control={control}
            name="name"
            rules={{ required: 'Name is required' }}
          />
        </FormRow>
        <FormRow label={'Source Data Type'}>
          <Controller
            control={control}
            name="kind"
            render={({ field: { onChange, value } }) => (
              <Radio.Group
                value={value}
                onChange={v => onChange(v)}
                withAsterisk
              >
                <Group>
                  <Radio value={SourceKind.Log} label="Log" />
                  <Radio value={SourceKind.Trace} label="Trace" />
                  {IS_METRICS_ENABLED && (
                    <Radio value={SourceKind.Metric} label="OTEL Metrics" />
                  )}
                  {IS_SESSIONS_ENABLED && (
                    <Radio value={SourceKind.Session} label="Session" />
                  )}
                </Group>
              </Radio.Group>
            )}
          />
        </FormRow>
        <FormRow label={'Server Connection'}>
          <ConnectionSelectControlled control={control} name={`connection`} />
        </FormRow>
        <FormRow label={'Database'}>
          <DatabaseSelectControlled
            control={control}
            name={`from.databaseName`}
            connectionId={connectionId}
          />
        </FormRow>
        {kind !== SourceKind.Metric && (
          <FormRow label={'Table'}>
            <DBTableSelectControlled
              database={databaseName}
              control={control}
              name={`from.tableName`}
              connectionId={connectionId}
              rules={{ required: 'Table is required' }}
            />
          </FormRow>
        )}
      </Stack>
      <TableModelForm
        control={control}
        watch={watch}
        setValue={setValue}
        kind={kind}
      />
    </div>
  );
}
