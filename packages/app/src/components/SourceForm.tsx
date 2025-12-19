import React, { useCallback, useEffect, useState } from 'react';
import {
  Control,
  Controller,
  useFieldArray,
  useForm,
  UseFormSetValue,
  UseFormWatch,
  useWatch,
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
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Grid,
  Group,
  Radio,
  Select,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCirclePlus,
  IconHelpCircle,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';

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
import {
  inferMaterializedViewConfig,
  MV_AGGREGATE_FUNCTIONS,
} from '@/utils/materializedViews';

import ConfirmDeleteMenu from './ConfirmDeleteMenu';
import { ConnectionSelectControlled } from './ConnectionSelect';
import { DatabaseSelectControlled } from './DatabaseSelect';
import { DBTableSelectControlled } from './DBTableSelect';
import { InputControlled } from './InputControlled';
import SelectControlled from './SelectControlled';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

const DEFAULT_DATABASE = 'default';

const MV_GRANULARITY_OPTIONS = [
  { value: '1 second', label: '1 second' },
  { value: '1 minute', label: '1 minute' },
  { value: '5 minute', label: '5 minutes' },
  { value: '15 minute', label: '15 minutes' },
  { value: '1 hour', label: '1 hour' },
  { value: '1 day', label: '1 day' },
];

const MV_AGGREGATE_FUNCTION_OPTIONS = MV_AGGREGATE_FUNCTIONS.map(fn => ({
  value: fn,
  label: fn,
}));

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
    <Flex align="flex-start">
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
            <Text tt="capitalize" size="sm">
              {label}
            </Text>
          ) : (
            label
          )}
        </Stack>
        <Center
          me="sm"
          ms="sm"
          style={{
            ...(!helpText ? { opacity: 0, pointerEvents: 'none' } : {}),
          }}
        >
          <Tooltip label={helpText} color="dark" c="white" multiline maw={600}>
            <IconHelpCircle size={20} className="cursor-pointer" />
          </Tooltip>
        </Center>
      </Flex>
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

function HighlightedAttributeExpressionsFormRow({
  control,
  watch,
  name,
  label,
  helpText,
}: TableModelProps & {
  name:
    | 'highlightedTraceAttributeExpressions'
    | 'highlightedRowAttributeExpressions';
  label: string;
  helpText?: string;
}) {
  const databaseName = watch(`from.databaseName`, DEFAULT_DATABASE);
  const tableName = watch(`from.tableName`);
  const connectionId = watch(`connection`);

  const {
    fields: highlightedAttributes,
    append: appendHighlightedAttribute,
    remove: removeHighlightedAttribute,
  } = useFieldArray({
    control,
    name,
  });

  return (
    <FormRow label={label} helpText={helpText}>
      <Grid columns={5}>
        {highlightedAttributes.map((field, index) => (
          <React.Fragment key={field.id}>
            <Grid.Col span={3} pe={0}>
              <SQLInlineEditorControlled
                tableConnection={{
                  databaseName,
                  tableName,
                  connectionId,
                }}
                control={control}
                name={`${name}.${index}.sqlExpression`}
                disableKeywordAutocomplete
                placeholder="ResourceAttributes['http.host']"
              />
            </Grid.Col>
            <Grid.Col span={2} ps="xs">
              <Flex align="center" gap="sm">
                <Text c="gray">AS</Text>
                <SQLInlineEditorControlled
                  control={control}
                  name={`${name}.${index}.alias`}
                  placeholder="Optional Alias"
                  disableKeywordAutocomplete
                />
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => removeHighlightedAttribute(index)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Flex>
            </Grid.Col>
            <Grid.Col span={3} pe={0}>
              <InputControlled
                control={control}
                name={`${name}.${index}.luceneExpression`}
                placeholder="ResourceAttributes.http.host (Optional) "
              />
            </Grid.Col>
            <Grid.Col span={1} pe={0}>
              <Text me="sm" mt={6}>
                <Tooltip
                  label={
                    'An optional, Lucene version of the above expression. If provided, it is used when searching for this attribute value.'
                  }
                  color="dark"
                  c="white"
                  multiline
                  maw={600}
                >
                  <IconHelpCircle size={14} className="cursor-pointer" />
                </Tooltip>
              </Text>
            </Grid.Col>
          </React.Fragment>
        ))}
      </Grid>
      <Button
        variant="default"
        size="sm"
        color="gray"
        className="align-self-start"
        mt={highlightedAttributes.length ? 'sm' : 'md'}
        onClick={() => {
          appendHighlightedAttribute({
            sqlExpression: '',
            luceneExpression: '',
            alias: '',
          });
        }}
      >
        <IconCirclePlus size={14} className="me-2" />
        Add expression
      </Button>
    </FormRow>
  );
}

/** Component for configuring one or more materialized views */
function MaterializedViewsFormSection({
  control,
  watch,
  setValue,
}: TableModelProps) {
  const databaseName =
    useWatch({ control, name: `from.databaseName` }) || DEFAULT_DATABASE;

  const {
    fields: materializedViews,
    append: appendMaterializedView,
    remove: removeMaterializedView,
  } = useFieldArray({
    control,
    name: 'materializedViews',
  });

  return (
    <Stack gap="md">
      <FormRow
        label={
          <Group>
            Materialized Views
            <Badge size="sm" radius="sm" color="gray">
              Beta
            </Badge>
          </Group>
        }
        helpText="Configure materialized views for query optimization. These pre-aggregated views can significantly improve query performance on aggregation queries."
      >
        <Stack gap="md">
          {materializedViews.map((field, index) => (
            <MaterializedViewFormSection
              key={field.id}
              watch={watch}
              control={control}
              mvIndex={index}
              setValue={setValue}
              onRemove={() => removeMaterializedView(index)}
            />
          ))}

          <Button
            variant="default"
            onClick={() => {
              appendMaterializedView({
                databaseName: databaseName,
                tableName: '',
                dimensionColumns: '',
                minGranularity: '',
                timestampColumn: '',
                aggregatedColumns: [],
              });
            }}
          >
            <Group>
              <IconCirclePlus size={16} />
              Add Materialized View
            </Group>
          </Button>
        </Stack>
      </FormRow>
    </Stack>
  );
}

/** Component for configuring a single materialized view */
function MaterializedViewFormSection({
  watch,
  control,
  mvIndex,
  onRemove,
  setValue,
}: { mvIndex: number; onRemove: () => void } & TableModelProps) {
  const connection = useWatch({ control, name: `connection` });
  const sourceDatabaseName =
    useWatch({ control, name: `from.databaseName` }) || DEFAULT_DATABASE;
  const mvDatabaseName =
    useWatch({ control, name: `materializedViews.${mvIndex}.databaseName` }) ||
    sourceDatabaseName;
  const mvTableName =
    useWatch({ control, name: `materializedViews.${mvIndex}.tableName` }) || '';

  return (
    <Stack gap="sm">
      <Grid columns={2} flex={1}>
        <Grid.Col span={1}>
          <DatabaseSelectControlled
            control={control}
            name={`materializedViews.${mvIndex}.databaseName`}
            connectionId={connection}
          />
        </Grid.Col>
        <Grid.Col span={1}>
          <Group>
            <Box flex={1}>
              <DBTableSelectControlled
                database={mvDatabaseName}
                control={control}
                name={`materializedViews.${mvIndex}.tableName`}
                connectionId={connection}
              />
            </Box>
            <ActionIcon size="sm" onClick={onRemove}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Grid.Col>

        <Grid.Col span={1}>
          <Text size="xs" fw={500} mb={4}>
            Timestamp Column
          </Text>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName: mvDatabaseName,
              tableName: mvTableName,
              connectionId: connection,
            }}
            control={control}
            placeholder="Timestamp"
            name={`materializedViews.${mvIndex}.timestampColumn`}
            disableKeywordAutocomplete
          />
        </Grid.Col>

        <Grid.Col span={1}>
          <Text size="xs" fw={500} mb={4}>
            Granularity
            <Tooltip
              label={'The granularity of the timestamp column'}
              color="dark"
              c="white"
              multiline
              maw={600}
            >
              <IconHelpCircle size={14} className="cursor-pointer ms-1" />
            </Tooltip>
          </Text>
          <Controller
            control={control}
            name={`materializedViews.${mvIndex}.minGranularity`}
            render={({ field }) => (
              <Select
                {...field}
                data={MV_GRANULARITY_OPTIONS}
                placeholder="Granularity"
                size="sm"
              />
            )}
          />
        </Grid.Col>
      </Grid>

      <Box>
        <Text size="xs" fw={500} mb={4}>
          Dimension Columns (comma-separated)
          <Tooltip
            label={
              'Columns which are not pre-aggregated in the materialized view and can be used for filtering and grouping.'
            }
            color="dark"
            c="white"
            multiline
            maw={600}
          >
            <IconHelpCircle size={14} className="cursor-pointer ms-1" />
          </Tooltip>
        </Text>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName: mvDatabaseName,
            tableName: mvTableName,
            connectionId: connection,
          }}
          control={control}
          name={`materializedViews.${mvIndex}.dimensionColumns`}
          placeholder="ServiceName, StatusCode"
          disableKeywordAutocomplete
        />
      </Box>

      <AggregatedColumnsFormSection
        control={control}
        mvIndex={mvIndex}
        watch={watch}
        setValue={setValue}
      />
      <Divider />
    </Stack>
  );
}

/** Component for configuring the Aggregated Columns list for a single materialized view */
function AggregatedColumnsFormSection({
  control,
  watch,
  setValue,
  mvIndex,
}: TableModelProps & { mvIndex: number }) {
  const {
    fields: aggregates,
    append: appendAggregate,
    remove: removeAggregate,
    replace: replaceAggregates,
  } = useFieldArray({
    control,
    name: `materializedViews.${mvIndex}.aggregatedColumns`,
  });

  const addAggregate = useCallback(() => {
    appendAggregate({ sourceColumn: '', aggFn: 'avg', mvColumn: '' });
  }, [appendAggregate]);

  useEffect(() => {
    const { unsubscribe } = watch(async (value, { name, type }) => {
      try {
        if (
          (value.kind === SourceKind.Log || value.kind === SourceKind.Trace) &&
          value.connection &&
          value.materializedViews?.[mvIndex] &&
          value.materializedViews[mvIndex].databaseName &&
          value.materializedViews[mvIndex].tableName &&
          value.from?.databaseName &&
          value.from?.tableName &&
          name === `materializedViews.${mvIndex}.tableName` &&
          type === 'change'
        ) {
          const mvDatabaseName = value.materializedViews[mvIndex].databaseName;
          const mvTableName = value.materializedViews[mvIndex].tableName;

          const config = await inferMaterializedViewConfig(
            {
              databaseName: mvDatabaseName,
              tableName: mvTableName,
              connectionId: value.connection,
            },
            {
              databaseName: value.from.databaseName,
              tableName: value.from.tableName,
              connectionId: value.connection,
            },
          );

          if (config) {
            setValue(`materializedViews.${mvIndex}`, config);
            replaceAggregates(config.aggregatedColumns ?? []);
            notifications.show({
              color: 'green',
              message:
                'Partially inferred materialized view configuration from view schema.',
            });
          } else {
            notifications.show({
              color: 'yellow',
              message: 'Unable to infer materialized view configuration.',
            });
          }
        }
      } catch (e) {
        console.error(e);
      }
    });

    return () => unsubscribe();
  }, [watch, mvIndex, replaceAggregates, setValue]);

  return (
    <Box>
      <Text size="xs" mb={4}>
        Pre-aggregated Columns
        <Tooltip
          label={'Columns which are pre-aggregated by the materialized view'}
          color="dark"
          c="white"
          multiline
          maw={600}
        >
          <IconHelpCircle size={14} className="cursor-pointer ms-1" />
        </Tooltip>
      </Text>
      <Grid columns={10}>
        {aggregates.map((field, colIndex) => (
          <AggregatedColumnRow
            key={field.id}
            watch={watch}
            setValue={setValue}
            control={control}
            mvIndex={mvIndex}
            colIndex={colIndex}
            onRemove={() => removeAggregate(colIndex)}
          />
        ))}
      </Grid>
      <Button size="sm" variant="default" onClick={addAggregate} mt="lg">
        <Group>
          <IconCirclePlus size={16} />
          Add Column
        </Group>
      </Button>
    </Box>
  );
}

/** Component to render one row in the MV Aggregated Columns section */
function AggregatedColumnRow({
  control,
  mvIndex,
  colIndex,
  onRemove,
}: TableModelProps & {
  mvIndex: number;
  colIndex: number;
  onRemove: () => void;
}) {
  const connectionId = useWatch({ control, name: `connection` });
  const sourceDatabaseName =
    useWatch({ control, name: `from.databaseName` }) || DEFAULT_DATABASE;
  const sourceTableName = useWatch({ control, name: `from.tableName` });
  const mvDatabaseName =
    useWatch({ control, name: `materializedViews.${mvIndex}.databaseName` }) ||
    sourceDatabaseName;
  const mvTableName = useWatch({
    control,
    name: `materializedViews.${mvIndex}.tableName`,
  });
  const isCount =
    useWatch({
      control,
      name: `materializedViews.${mvIndex}.aggregatedColumns.${colIndex}.aggFn`,
    }) === 'count';

  return (
    <>
      <Grid.Col span={2}>
        <SelectControlled
          control={control}
          name={`materializedViews.${mvIndex}.aggregatedColumns.${colIndex}.aggFn`}
          data={MV_AGGREGATE_FUNCTION_OPTIONS}
          size="sm"
        />
      </Grid.Col>
      {!isCount && (
        <Grid.Col span={4}>
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName: sourceDatabaseName,
              tableName: sourceTableName,
              connectionId,
            }}
            control={control}
            name={`materializedViews.${mvIndex}.aggregatedColumns.${colIndex}.sourceColumn`}
            placeholder="Source Column"
            disableKeywordAutocomplete
          />
        </Grid.Col>
      )}
      <Grid.Col span={!isCount ? 4 : 8}>
        <Group wrap="nowrap">
          <Box flex={1}>
            <SQLInlineEditorControlled
              tableConnection={{
                databaseName: mvDatabaseName,
                tableName: mvTableName,
                connectionId,
              }}
              control={control}
              name={`materializedViews.${mvIndex}.aggregatedColumns.${colIndex}.mvColumn`}
              placeholder="View Column"
              disableKeywordAutocomplete
            />
          </Box>
          <ActionIcon size="sm" onClick={onRemove}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Grid.Col>
    </>
  );
}

// traceModel= ...
// logModel=....
// traceModel.logModel = 'custom'
// will pop open the custom trace model form as well
// need to make sure we don't recursively render them :joy:
// OR traceModel.logModel = 'log_id_blah'
// custom always points towards the url param

export function LogTableModelForm(props: TableModelProps) {
  const { control, watch } = props;
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
            >
              <Group gap="xs">
                <IconSettings size={14} />
                Configure Optional Fields
              </Group>
            </Anchor>
          )}
          {showOptionalFields && (
            <Button
              onClick={() => setShowOptionalFields(false)}
              size="xs"
              variant="subtle"
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
          helpText="This DateTime column is used to display and order search results."
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
        <Divider />
        <HighlightedAttributeExpressionsFormRow
          {...props}
          name="highlightedRowAttributeExpressions"
          label="Highlighted Attributes"
          helpText="Expressions defining row-level attributes which are displayed in the row side panel for the selected row."
        />
        <HighlightedAttributeExpressionsFormRow
          {...props}
          name="highlightedTraceAttributeExpressions"
          label="Highlighted Trace Attributes"
          helpText="Expressions defining trace-level attributes which are displayed in the trace view for the selected trace."
        />
        <Divider />
        <MaterializedViewsFormSection {...props} />
      </Stack>
    </>
  );
}

export function TraceTableModelForm(props: TableModelProps) {
  const { control, watch } = props;
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
      <FormRow
        label={'Displayed Timestamp Column'}
        helpText="This DateTime column is used to display and order search results."
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
      <HighlightedAttributeExpressionsFormRow
        {...props}
        name="highlightedRowAttributeExpressions"
        label="Highlighted Attributes"
        helpText="Expressions defining row-level attributes which are displayed in the row side panel for the selected row"
      />
      <HighlightedAttributeExpressionsFormRow
        {...props}
        name="highlightedTraceAttributeExpressions"
        label="Highlighted Trace Attributes"
        helpText="Expressions defining trace-level attributes which are displayed in the trace view for the selected trace."
      />
      <Divider />
      <MaterializedViewsFormSection {...props} />
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
  const handleError = useCallback(
    (error: z.ZodError<TSourceUnion>) => {
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
    },
    [setError],
  );

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
    clearErrors,
    handleError,
    sourceFormSchema,
    handleSubmit,
    createSource,
    onCreate,
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
  }, [
    handleSubmit,
    updateSource,
    onSave,
    clearErrors,
    handleError,
    sourceFormSchema,
  ]);

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
          <Text>Source Settings</Text>
          <Group>
            {onCancel && (
              <Button variant="outline" onClick={onCancel} size="xs">
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
