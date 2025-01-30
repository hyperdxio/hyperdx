import React, { useCallback, useEffect, useState } from 'react';
import {
  Control,
  Controller,
  useForm,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Menu,
  Radio,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { useConnections } from '@/connection';
import {
  inferTableSourceConfig,
  useCreateSource,
  useDeleteSource,
  useSource,
  useUpdateSource,
} from '@/source';

import ConfirmDeleteMenu from './ConfirmDeleteMenu';
import { ConnectionSelectControlled } from './ConnectionSelect';
import { DatabaseSelectControlled } from './DatabaseSelect';
import { DBTableSelectControlled } from './DBTableSelect';
import { InputControlled } from './InputControlled';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

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
          <Text c="gray.6" size="sm">
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
        <Tooltip label={helpText} color="dark" c="white">
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

export function LogTableModelForm({
  control,
  watch,
  setValue,
}: {
  control: Control<TSource>;
  watch: UseFormWatch<TSource>;
  setValue: UseFormSetValue<TSource>;
}) {
  const DEFAULT_DATABASE = 'default';
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const tableName = watch(`from.tableName`);
  const connectionId = watch(`connection`);

  const [showOptionalFields, setShowOptionalFields] = useState(false);

  return (
    <>
      <Stack gap="sm">
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
        <FormRow label={'Table'}>
          <DBTableSelectControlled
            database={databaseName}
            control={control}
            name={`from.tableName`}
            connectionId={connectionId}
            rules={{ required: 'Table is required' }}
          />
        </FormRow>
        <FormRow
          label={'Timestamp Column'}
          helpText="DateTime column or expression that is part of your table's primary key."
        >
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="timestampValueExpression"
            disableKeywordAutocomplete
            connectionId={connectionId}
          />
        </FormRow>
        <FormRow
          label={'Default Select'}
          helpText="Default columns selected in search results (this can be customized per search later)"
        >
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="defaultTableSelectExpression"
            placeholder="Timestamp, Body"
            connectionId={connectionId}
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
            database={databaseName}
            table={tableName}
            control={control}
            name="serviceNameExpression"
            placeholder="ServiceName"
            connectionId={connectionId}
          />
        </FormRow>
        <FormRow label={'Log Level Expression'}>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="severityTextExpression"
            placeholder="SeverityText"
            connectionId={connectionId}
          />
        </FormRow>
        <FormRow label={'Log Attributes Expression'}>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="eventAttributesExpression"
            placeholder="LogAttributes"
            connectionId={connectionId}
          />
        </FormRow>
        <FormRow label={'Resource Attributes Expression'}>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="resourceAttributesExpression"
            placeholder="ResourceAttributes"
            connectionId={connectionId}
          />
        </FormRow>
        <Divider />
        <FormRow
          label={'Correlated Trace Source'}
          helpText="HyperDX Source for traces associated with logs. Optional"
        >
          <SourceSelectControlled control={control} name="traceSourceId" />
        </FormRow>

        <FormRow label={'Trace Id Expression'}>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="traceIdExpression"
            placeholder="TraceId"
            connectionId={connectionId}
          />
        </FormRow>
        <FormRow label={'Span Id Expression'}>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="spanIdExpression"
            placeholder="SpanId"
            connectionId={connectionId}
          />
        </FormRow>
        <Divider />
        {/* <FormRow
          label={'Unique Row ID Expression'}
          helpText="Unique identifier for a given row, will be primary key if not specified. Used for showing full row details in search results."
        >
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="uniqueRowIdExpression"
            placeholder="Timestamp, ServiceName, Body"
            connectionId={connectionId}
          />
        </FormRow> */}
        {/* <FormRow label={'Table Filter Expression'}>
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="tableFilterExpression"
            placeholder="ServiceName = 'only_this_service'"
            connectionId={connectionId}
          />
        </FormRow> */}
        <FormRow
          label={'Implicit Column Expression'}
          helpText="Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log."
        >
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            control={control}
            name="implicitColumnExpression"
            placeholder="Body"
            connectionId={connectionId}
          />
        </FormRow>
      </Stack>
    </>
  );
}

export function TraceTableModelForm({
  control,
  watch,
  setValue,
}: {
  control: Control<TSource>;
  watch: UseFormWatch<TSource>;
  setValue: UseFormSetValue<TSource>;
}) {
  const DEFAULT_DATABASE = 'default';
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const tableName = watch(`from.tableName`);
  const connectionId = watch(`connection`);

  return (
    <Stack gap="sm">
      <FormRow label={'Server Connection'}>
        <ConnectionSelectControlled control={control} name={`connection`} />
      </FormRow>
      <FormRow label={'Database'}>
        <DatabaseSelectControlled
          connectionId={connectionId}
          control={control}
          name={`from.databaseName`}
        />
      </FormRow>
      <FormRow label={'Table'}>
        <DBTableSelectControlled
          connectionId={connectionId}
          database={databaseName}
          control={control}
          name={`from.tableName`}
          rules={{ required: 'Table is required' }}
        />
      </FormRow>
      <FormRow label={'Timestamp Column'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
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
          database={databaseName}
          table={tableName}
          control={control}
          name="defaultTableSelectExpression"
          placeholder="Timestamp, ServiceName, StatusCode, Duration, SpanName"
          connectionId={connectionId}
        />
      </FormRow>
      <Divider />
      <FormRow label={'Duration Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
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
            render={({ field: { onChange, onBlur, value, ref } }) => (
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
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="traceIdExpression"
          placeholder="TraceId"
        />
      </FormRow>
      <FormRow label={'Span Id Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="spanIdExpression"
          placeholder="SpanId"
        />
      </FormRow>
      <FormRow label={'Parent Span Id Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="parentSpanIdExpression"
          placeholder="ParentSpanId"
        />
      </FormRow>
      <FormRow label={'Span Name Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="spanNameExpression"
          placeholder="SpanName"
        />
      </FormRow>
      <FormRow label={'Span Kind Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
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
      <FormRow label={'Status Code Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="statusCodeExpression"
          placeholder="StatusCode"
        />
      </FormRow>
      <FormRow label={'Status Message Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="statusMessageExpression"
          placeholder="StatusMessage"
        />
      </FormRow>
      <FormRow label={'Service Name Expression'}>
        <SQLInlineEditorControlled
          connectionId={connectionId}
          database={databaseName}
          table={tableName}
          control={control}
          name="serviceNameExpression"
          placeholder="ServiceName"
        />
      </FormRow>
      <FormRow label={'Resource Attributes Expression'}>
        <SQLInlineEditorControlled
          database={databaseName}
          table={tableName}
          control={control}
          name="resourceAttributesExpression"
          placeholder="ResourceAttributes"
          connectionId={connectionId}
        />
      </FormRow>
      <FormRow label={'Event Attributes Expression'}>
        <SQLInlineEditorControlled
          database={databaseName}
          table={tableName}
          control={control}
          name="eventAttributesExpression"
          placeholder="SpanAttributes"
          connectionId={connectionId}
        />
      </FormRow>
      <FormRow
        label={'Implicit Column Expression'}
        helpText="Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log."
      >
        <SQLInlineEditorControlled
          database={databaseName}
          table={tableName}
          control={control}
          name="implicitColumnExpression"
          placeholder="SpanName"
          connectionId={connectionId}
        />
      </FormRow>
    </Stack>
  );
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

  const { watch, control, setValue, handleSubmit, resetField, formState } =
    useForm<TSource>({
      defaultValues: {
        kind: SourceKind.Log,
        name: defaultName,
        connection: connections?.[0]?.id,
        from: {
          databaseName: 'default',
          tableName: '',
        },
      },
      values: source,
      resetOptions: {
        keepDirtyValues: true,
        keepErrors: true,
      },
    });

  useEffect(() => {
    const { unsubscribe } = watch(async (value, { name, type }) => {
      try {
        if (
          value.connection != null &&
          value.from?.databaseName != null &&
          value.from.tableName != null &&
          name === 'from.tableName' &&
          type === 'change'
        ) {
          const config = await inferTableSourceConfig({
            databaseName: value.from.databaseName,
            tableName: value.from.tableName,
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

  const _onCreate = useCallback(() => {
    handleSubmit(data => {
      createSource.mutate(
        { source: data },
        {
          onSuccess: data => {
            onCreate?.(data);
            notifications.show({
              color: 'green',
              message: 'Source created',
            });
          },
          onError: () => {
            notifications.show({
              color: 'red',
              message: 'Failed to create source',
            });
          },
        },
      );
    })();
  }, [handleSubmit, createSource, onCreate]);

  const _onSave = useCallback(() => {
    handleSubmit(data => {
      updateSource.mutate(
        { source: data },
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
                  <Radio value={SourceKind.Session} label="Session" />
                </Group>
              </Radio.Group>
            )}
          />
        </FormRow>
      </Stack>
      {kind === SourceKind.Trace ? (
        <TraceTableModelForm
          // @ts-ignore
          control={control}
          // @ts-ignore
          watch={watch}
          // @ts-ignore
          setValue={setValue}
        />
      ) : (
        <LogTableModelForm
          control={control}
          watch={watch}
          setValue={setValue}
        />
      )}
    </div>
  );
}
