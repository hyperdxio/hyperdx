import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  SourceKind,
  SourceSchema,
  SourceSchemaNoId,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Button,
  Code,
  Flex,
  Grid,
  Group,
  Modal,
  Paper,
  Radio,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCirclePlus, IconTrash } from '@tabler/icons-react';

import ConfirmDeleteMenu from '@/components/ConfirmDeleteMenu';
import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import { DatabaseSelectControlled } from '@/components/DatabaseSelect';
import { DBTableSelectControlled } from '@/components/DBTableSelect';
import {
  AutocompleteControlled,
  InputControlled,
} from '@/components/InputControlled';
import {
  IS_METRICS_ENABLED,
  IS_PROMQL_ENABLED,
  IS_SESSIONS_ENABLED,
} from '@/config';
import { useConnections } from '@/connection';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import {
  inferTableSourceConfig,
  useCreateSource,
  useDeleteSource,
  useSource,
  useSources,
  useUpdateSource,
} from '@/source';
import {
  getSourceConfigPairingWarnings,
  PairingWarning,
} from '@/utils/sourceFieldSuggestions';

import { DEFAULT_DATABASE, PROMETHEUS_PLACEHOLDER } from './constants';
import {
  CORRELATION_FIELD_MAP,
  CorrelationField,
  getCorrelationFieldValue,
  setCorrelationFieldValue,
} from './correlationFields';
import { FormRow } from './FormRow';
import { distinctSections } from './sourceFormUtils';
import { TableModelForm } from './TableModelForm';

export function TableSourceForm({
  sourceId,
  onSave,
  onCreate,
  isNew = false,
  defaultName = '',
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

  const { control, setValue, handleSubmit, resetField, setError, clearErrors } =
    useForm<TSource>({
      defaultValues: {
        kind: SourceKind.Log,
        name: defaultName,
        connection: connections?.[0]?.id,
        from: {
          databaseName: 'default',
          tableName: '',
        },
        querySettings: source?.querySettings,
      },
      values: source,
      resetOptions: {
        keepDirtyValues: true,
        keepErrors: true,
      },
    });

  const watchedConnection = useWatch({
    control,
    name: 'connection',
    defaultValue: source?.connection,
  });
  const watchedDatabaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: source?.from?.databaseName || DEFAULT_DATABASE,
  });
  const watchedTableName = useWatch({
    control,
    name: 'from.tableName',
    defaultValue: source?.from?.tableName,
  });
  const watchedKind = useWatch({
    control,
    name: 'kind',
    defaultValue: source?.kind || SourceKind.Log,
  });
  const prevTableNameRef = useRef(watchedTableName);

  const selectedConnection = useMemo(
    () => connections?.find(c => c.id === watchedConnection),
    [connections, watchedConnection],
  );
  const isPrometheusOnlyConnection = Boolean(
    selectedConnection?.isPrometheusEndpoint,
  );

  useEffect(() => {
    if (!isPrometheusOnlyConnection) return;
    if (watchedDatabaseName !== PROMETHEUS_PLACEHOLDER) {
      setValue('from.databaseName', PROMETHEUS_PLACEHOLDER, {
        shouldDirty: true,
      });
    }
    if (watchedTableName !== PROMETHEUS_PLACEHOLDER) {
      setValue('from.tableName', PROMETHEUS_PLACEHOLDER, {
        shouldDirty: true,
      });
    }
  }, [
    isPrometheusOnlyConnection,
    setValue,
    watchedDatabaseName,
    watchedTableName,
  ]);

  const metadata = useMetadataWithSettings();

  useEffect(() => {
    (async () => {
      try {
        if (watchedTableName !== prevTableNameRef.current) {
          prevTableNameRef.current = watchedTableName;

          if (isPrometheusOnlyConnection) {
            return;
          }

          if (
            watchedConnection != null &&
            watchedDatabaseName != null &&
            (watchedKind === SourceKind.Metric || watchedTableName != null)
          ) {
            const config = await inferTableSourceConfig({
              databaseName: watchedDatabaseName,
              tableName:
                watchedKind !== SourceKind.Metric ? watchedTableName : '',
              connectionId: watchedConnection,
              kind: watchedKind,
              metadata,
            });
            if (Object.keys(config).length > 0) {
              notifications.show({
                color: 'green',
                message:
                  'Automatically inferred source configuration from table schema.',
              });
            }
            Object.entries(config).forEach(([key, value]) => {
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                setValue(key as any, value);
                return;
              }
              resetField(key as any, {
                keepDirty: true,
                defaultValue: value,
              });
            });
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [
    watchedTableName,
    watchedConnection,
    watchedDatabaseName,
    watchedKind,
    resetField,
    metadata,
    setValue,
    isPrometheusOnlyConnection,
  ]);

  // Sets the default connection field to the first connection after the
  // connections have been loaded
  useEffect(() => {
    resetField('connection', { defaultValue: connections?.[0]?.id });
  }, [connections, resetField]);

  const kind = useWatch({
    control,
    name: 'kind',
    defaultValue: source?.kind || SourceKind.Log,
  });

  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();

  // Bidirectional source linking
  const { data: sources } = useSources();
  // Existing section names, offered as Section autocomplete suggestions.
  const sectionSuggestions = useMemo(
    () => distinctSections(sources),
    [sources],
  );
  const currentSourceId = useWatch({ control, name: 'id' });

  // Watch all potential correlation fields
  const logSourceId = useWatch({ control, name: 'logSourceId' });
  const traceSourceId = useWatch({ control, name: 'traceSourceId' });
  const metricSourceId = useWatch({ control, name: 'metricSourceId' });
  const sessionTraceSourceId = useWatch({ control, name: 'traceSourceId' }); // For sessions

  const prevLogSourceIdRef = useRef(logSourceId);
  const prevTraceSourceIdRef = useRef(traceSourceId);
  const prevMetricSourceIdRef = useRef(metricSourceId);
  const prevSessionTraceSourceIdRef = useRef(sessionTraceSourceId);

  useEffect(() => {
    (async () => {
      if (!currentSourceId || !sources || !kind) return;

      const correlationFields = CORRELATION_FIELD_MAP[kind];
      if (!correlationFields) return;

      // Check each field for changes
      const changedFields: Array<{
        name: CorrelationField;
        value: string | undefined;
      }> = [];

      if (logSourceId !== prevLogSourceIdRef.current) {
        prevLogSourceIdRef.current = logSourceId;
        changedFields.push({
          name: 'logSourceId',
          value: logSourceId ?? undefined,
        });
      }
      if (traceSourceId !== prevTraceSourceIdRef.current) {
        prevTraceSourceIdRef.current = traceSourceId;
        changedFields.push({
          name: 'traceSourceId',
          value: traceSourceId ?? undefined,
        });
      }
      if (metricSourceId !== prevMetricSourceIdRef.current) {
        prevMetricSourceIdRef.current = metricSourceId;
        changedFields.push({
          name: 'metricSourceId',
          value: metricSourceId ?? undefined,
        });
      }
      if (
        sessionTraceSourceId !== prevSessionTraceSourceIdRef.current &&
        kind === SourceKind.Session
      ) {
        prevSessionTraceSourceIdRef.current = sessionTraceSourceId;
        changedFields.push({
          name: 'traceSourceId',
          value: sessionTraceSourceId ?? undefined,
        });
      }

      for (const {
        name: fieldName,
        value: newTargetSourceId,
      } of changedFields) {
        const targetConfigs = correlationFields[fieldName];
        if (!targetConfigs) continue;

        for (const { targetKind, targetField } of targetConfigs) {
          // Find the previously linked source if any
          const previouslyLinkedSource = sources.find(
            s =>
              s.kind === targetKind &&
              getCorrelationFieldValue(s, targetField) === currentSourceId,
          );

          // If there was a previously linked source and it's different from the new one, unlink it
          if (
            previouslyLinkedSource &&
            previouslyLinkedSource.id !== newTargetSourceId
          ) {
            await updateSource.mutateAsync({
              source: setCorrelationFieldValue(
                previouslyLinkedSource,
                targetField,
                undefined,
              ),
            });
          }

          // If a new source is selected, link it back
          if (newTargetSourceId) {
            const targetSource = sources.find(s => s.id === newTargetSourceId);
            if (targetSource && targetSource.kind === targetKind) {
              // Only update if the target field is empty to avoid overwriting existing correlations
              if (!getCorrelationFieldValue(targetSource, targetField)) {
                await updateSource.mutateAsync({
                  source: setCorrelationFieldValue(
                    targetSource,
                    targetField,
                    currentSourceId,
                  ),
                });
              }
            }
          }
        }
      }
    })();
  }, [
    logSourceId,
    traceSourceId,
    metricSourceId,
    sessionTraceSourceId,
    kind,
    currentSourceId,
    sources,
    updateSource,
  ]);

  const handleError = useCallback(
    ({ errors }: z.ZodError<TSource>, eventName: 'create' | 'save') => {
      const notificationMsgs: string[] = [];

      // eslint-disable-next-line no-console
      console.debug(
        // HDX-3148
        `[${eventName}] SourceForm validation error`,
        JSON.stringify(errors),
      );

      for (const err of errors) {
        const errorPath: string = err.path.join('.');
        // react-hook-form requires a static path type; dynamic errorPath needs assertion
        setError(errorPath as any, { ...err });

        const message =
          // HDX-3148
          err.message === 'Required'
            ? `${errorPath}: ${err.message}`
            : err.message;

        notificationMsgs.push(message);
      }

      notifications.show({
        color: 'red',
        message: (
          <Stack>
            <Text size="sm">
              <b>Failed to create source</b>
            </Text>
            {notificationMsgs.map((message, i) => (
              <Text key={i} size="sm">
                ✖ {message}
              </Text>
            ))}
          </Stack>
        ),
      });
    },
    [setError],
  );

  const [pendingSave, setPendingSave] = useState<{
    warnings: PairingWarning[];
    parsedData: any;
    persist: (data: any) => void;
  }>();

  const applyPairingFix = useCallback(
    (warning: PairingWarning) => {
      if (!pendingSave) {
        return;
      }

      const { field, value } = warning.suggestedFix;

      setValue(field, value, { shouldDirty: true });

      const remaining = pendingSave.warnings.filter(w => w !== warning);

      const patched = { ...pendingSave.parsedData, [field]: value };

      if (remaining.length === 0) {
        setPendingSave(undefined);
        pendingSave.persist(patched);
      } else {
        setPendingSave({
          ...pendingSave,
          warnings: remaining,
          parsedData: patched,
        });
      }
    },
    [pendingSave, setValue],
  );

  const _onCreate = useCallback(() => {
    clearErrors();
    handleSubmit(async data => {
      const parseResult = SourceSchemaNoId.safeParse(data);
      if (parseResult.error) {
        handleError(parseResult.error, 'create');
        return;
      }

      const persist = (source: typeof parseResult.data) =>
        createSource.mutate(
          { source },
          {
            onSuccess: async newSource => {
              // Handle bidirectional linking for new sources
              const correlationFields = CORRELATION_FIELD_MAP[newSource.kind];
              if (correlationFields && sources) {
                for (const [fieldName, targetConfigs] of Object.entries(
                  correlationFields,
                )) {
                  const targetSourceId = getCorrelationFieldValue(
                    newSource,
                    fieldName as CorrelationField,
                  );
                  if (targetSourceId) {
                    for (const { targetKind, targetField } of targetConfigs) {
                      const targetSource = sources.find(
                        s => s.id === targetSourceId,
                      );
                      if (targetSource && targetSource.kind === targetKind) {
                        // Only update if the target field is empty to avoid overwriting existing correlations
                        if (
                          !getCorrelationFieldValue(targetSource, targetField)
                        ) {
                          await updateSource.mutateAsync({
                            source: setCorrelationFieldValue(
                              targetSource,
                              targetField,
                              newSource.id,
                            ),
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

      const warnings = getSourceConfigPairingWarnings(data);

      if (warnings.length > 0) {
        setPendingSave({ warnings, parsedData: parseResult.data, persist });
        return;
      }

      persist(parseResult.data);
    })();
  }, [
    clearErrors,
    handleError,
    handleSubmit,
    createSource,
    onCreate,
    sources,
    updateSource,
  ]);

  const _onSave = useCallback(() => {
    clearErrors();
    handleSubmit(data => {
      const parseResult = SourceSchema.safeParse(data);
      if (parseResult.error) {
        handleError(parseResult.error, 'save');
        return;
      }

      const persist = (source: typeof parseResult.data) =>
        updateSource.mutate(
          { source },
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

      const warnings = getSourceConfigPairingWarnings(data);

      if (warnings.length > 0) {
        setPendingSave({ warnings, parsedData: parseResult.data, persist });
        return;
      }

      persist(parseResult.data);
    })();
  }, [handleSubmit, updateSource, onSave, clearErrors, handleError]);

  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: source?.from?.databaseName || DEFAULT_DATABASE,
  });
  const connectionId = useWatch({
    control,
    name: 'connection',
    defaultValue: source?.connection,
  });

  const {
    fields: querySettingFields,
    append: appendSetting,
    remove: removeSetting,
  } = useFieldArray({ control, name: 'querySettings' });

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
          <Text>Source Settings</Text>
          {!isNew && (
            <Controller
              control={control}
              name="disabled"
              render={({ field: { value, onChange } }) => (
                <Switch
                  size="sm"
                  checked={!value}
                  onChange={event => onChange(!event.currentTarget.checked)}
                  label={value ? 'Disabled' : 'Enabled'}
                />
              )}
            />
          )}
        </Flex>
        <FormRow label={'Name'}>
          <InputControlled
            control={control}
            name="name"
            rules={{ required: 'Name is required' }}
          />
        </FormRow>
        <FormRow label={'Section'}>
          <AutocompleteControlled
            control={control}
            name="section"
            data={sectionSuggestions}
            placeholder="Optional group, e.g. Billing or Control Plane Prod"
            maxLength={256}
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
                  {IS_PROMQL_ENABLED && (
                    <Radio value={SourceKind.Promql} label="PromQL" />
                  )}
                </Group>
              </Radio.Group>
            )}
          />
        </FormRow>
        <FormRow label={'Server Connection'}>
          <ConnectionSelectControlled control={control} name={`connection`} />
        </FormRow>
        {!isPrometheusOnlyConnection && (
          <>
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
          </>
        )}
        <FormRow
          label={
            <Anchor
              href="https://clickhouse.com/docs/operations/settings/settings"
              size="sm"
              target="_blank"
            >
              Query Settings
            </Anchor>
          }
          helpText="Query-level Session Settings that will be added to each query for this source."
        >
          <Grid columns={11}>
            {querySettingFields.map((field, index) => (
              <Fragment key={field.id}>
                <Grid.Col span={5} pe={0}>
                  <InputControlled
                    placeholder="Setting"
                    control={control}
                    name={`querySettings.${index}.setting`}
                  />
                </Grid.Col>
                <Grid.Col span={5} pe={0}>
                  <InputControlled
                    placeholder="Value"
                    control={control}
                    name={`querySettings.${index}.value`}
                  />
                </Grid.Col>
                <Grid.Col span={1} ps={0}>
                  <Flex align="center" justify="center" gap="sm" h="100%">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      title="Remove setting"
                      onClick={() => removeSetting(index)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Flex>
                </Grid.Col>
              </Fragment>
            ))}
          </Grid>
          <Button
            variant="secondary"
            size="sm"
            color="gray"
            mt="md"
            disabled={querySettingFields.length >= 10}
            onClick={() => {
              if (querySettingFields.length < 10) {
                appendSetting({ setting: '', value: '' });
              }
            }}
          >
            <IconCirclePlus size={14} className="me-2" />
            Add Setting
          </Button>
        </FormRow>
      </Stack>
      <TableModelForm control={control} setValue={setValue} kind={kind} />
      <Group justify="flex-end" mt="lg">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} size="xs">
            Cancel
          </Button>
        )}
        {isNew ? (
          <Button
            variant="primary"
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
              variant="primary"
              onClick={_onSave}
              size="xs"
              loading={createSource.isPending}
            >
              Save Source
            </Button>
          </>
        )}
      </Group>
      <Modal
        size="lg"
        opened={!!pendingSave}
        onClose={() => setPendingSave(undefined)}
        title="Review source configuration"
        centered
      >
        <Stack gap="md">
          {pendingSave?.warnings.map(warning => (
            <Paper key={warning.field} p="sm">
              <Text size="sm">{warning.message}</Text>
              <Text mt="md" fw="bold" color="green" size="sm">
                Recommended ({warning.recommendation}):
              </Text>

              <Group
                mt="sm"
                justify="space-between"
                align="center"
                wrap="nowrap"
              >
                <Code
                  block
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  {warning.suggestedFix.value}
                </Code>
                <Button
                  variant="secondary"
                  size="xs"
                  style={{ flexShrink: 0 }}
                  onClick={() => applyPairingFix(warning)}
                >
                  Use this value
                </Button>
              </Group>
            </Paper>
          ))}
          <Group justify="flex-end" mt="sm">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setPendingSave(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="xs"
              onClick={() => {
                const p = pendingSave;
                setPendingSave(undefined);
                p?.persist(p.parsedData);
              }}
            >
              Save anyway
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
