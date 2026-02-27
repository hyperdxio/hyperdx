import React, {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Control,
  Controller,
  useFieldArray,
  useForm,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { z } from 'zod';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
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
import { DateInput } from '@mantine/dates';
import { useDebouncedCallback, useDidUpdate } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconCirclePlus,
  IconHelpCircle,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';

import { SQLInlineEditorControlled } from '@/components/SearchInput/SQLInlineEditor';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { IS_METRICS_ENABLED, IS_SESSIONS_ENABLED } from '@/config';
import { useConnections } from '@/connection';
import { useExplainQuery } from '@/hooks/useExplainQuery';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
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
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import {
  inferMaterializedViewConfig,
  MV_AGGREGATE_FUNCTIONS,
  MV_GRANULARITY_OPTIONS,
} from '@/utils/materializedViews';

import ConfirmDeleteMenu from '../ConfirmDeleteMenu';
import { ConnectionSelectControlled } from '../ConnectionSelect';
import { DatabaseSelectControlled } from '../DatabaseSelect';
import { DBTableSelectControlled } from '../DBTableSelect';
import { ErrorCollapse } from '../Error/ErrorCollapse';
import { InputControlled } from '../InputControlled';
import SelectControlled from '../SelectControlled';

const DEFAULT_DATABASE = 'default';

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

type HighlightedAttributeRowProps = Omit<TableModelProps, 'setValue'> & {
  id: string;
  index: number;
  databaseName: string;
  name:
    | 'highlightedTraceAttributeExpressions'
    | 'highlightedRowAttributeExpressions';
  tableName: string;
  connectionId: string;
  removeHighlightedAttribute: (index: number) => void;
};

function HighlightedAttributeRow({
  id,
  index,
  control,
  databaseName,
  name,
  tableName,
  connectionId,
  removeHighlightedAttribute,
}: HighlightedAttributeRowProps) {
  const expressionInput = useWatch({
    control,
    name: `${name}.${index}.sqlExpression`,
  });

  const aliasInput = useWatch({
    control,
    name: `${name}.${index}.alias`,
  });

  const [explainParams, setExplainParams] = useState<{
    expression: typeof expressionInput;
    alias: typeof aliasInput;
  }>();

  const setExplainParamsDebounced = useDebouncedCallback(
    (params: typeof explainParams) => {
      setExplainParams(params);
    },
    1_000,
  );

  useDidUpdate(() => {
    setExplainParamsDebounced({
      expression: expressionInput,
      alias: aliasInput,
    });
  }, [expressionInput, aliasInput]);

  const {
    data: explainData,
    error: explainError,
    isLoading: explainLoading,
  } = useExplainQuery(
    {
      from: { databaseName, tableName },
      connection: connectionId,
      select: [
        {
          alias: explainParams?.alias,
          valueExpression: explainParams?.expression ?? '',
        },
      ],
      where: '',
    },

    {
      enabled: !!explainParams?.expression,
    },
  );

  const runExpression = () => {
    setExplainParams({
      expression: expressionInput,
      alias: aliasInput,
    });
  };

  const isExpressionValid = !!explainData?.length;
  const isExpressionInvalid = explainError instanceof ClickHouseQueryError;

  const shouldShowResult =
    explainParams?.expression === expressionInput &&
    explainParams?.alias === aliasInput &&
    (isExpressionValid || isExpressionInvalid);

  return (
    <React.Fragment key={id}>
      <Grid.Col span={3} pe={0}>
        <div
          style={{ display: 'contents' }}
          data-name={`${name}.${index}.sqlExpression`}
        >
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
        </div>
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
          <Tooltip label="Validate expression">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              loading={explainLoading}
              disabled={!expressionInput || explainLoading}
              onClick={runExpression}
            >
              <IconCheck size={16} />
            </ActionIcon>
          </Tooltip>
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

      {shouldShowResult && (
        <Grid.Col span={5} pe={0} pt={0}>
          {isExpressionValid && (
            <Text c="green" size="xs">
              Expression is valid.
            </Text>
          )}
          {isExpressionInvalid && (
            <ErrorCollapse
              summary="Expression is invalid"
              details={explainError?.message}
            />
          )}
        </Grid.Col>
      )}

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
  );
}

function HighlightedAttributeExpressionsFormRow({
  control,
  name,
  label,
  helpText,
}: Omit<TableModelProps, 'setValue'> & {
  name:
    | 'highlightedTraceAttributeExpressions'
    | 'highlightedRowAttributeExpressions';
  label: string;
  helpText?: string;
}) {
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const connectionId = useWatch({ control, name: 'connection' });

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
        {highlightedAttributes.map(({ id }, index) => (
          <HighlightedAttributeRow
            key={id}
            {...{
              id,
              index,
              name,
              control,
              databaseName,
              tableName,
              connectionId,
              removeHighlightedAttribute,
            }}
          />
        ))}
      </Grid>
      <Button
        variant="secondary"
        size="sm"
        className="align-self-start"
        mt={highlightedAttributes.length ? 'sm' : 'md'}
        onClick={() => {
          appendHighlightedAttribute(
            {
              sqlExpression: '',
              luceneExpression: '',
              alias: '',
            },
            { shouldFocus: false },
          );
        }}
      >
        <IconCirclePlus size={14} className="me-2" />
        Add expression
      </Button>
    </FormRow>
  );
}

/** Component for configuring one or more materialized views */
function MaterializedViewsFormSection({ control, setValue }: TableModelProps) {
  const databaseName = useWatch({
    control,
    name: `from.databaseName`,
    defaultValue: DEFAULT_DATABASE,
  });

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
        label="Materialized Views"
        helpText="Configure materialized views for query optimization. These pre-aggregated views can significantly improve query performance on aggregation queries."
      >
        <Stack gap="md">
          {materializedViews.map((field, index) => (
            <MaterializedViewFormSection
              key={field.id}
              control={control}
              mvIndex={index}
              setValue={setValue}
              onRemove={() => removeMaterializedView(index)}
            />
          ))}

          <Button
            variant="secondary"
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
  control,
  mvIndex,
  onRemove,
  setValue,
}: { mvIndex: number; onRemove: () => void } & TableModelProps) {
  const brandName = useBrandDisplayName();
  const connection = useWatch({ control, name: `connection` });
  const sourceDatabaseName = useWatch({
    control,
    name: `from.databaseName`,
    defaultValue: DEFAULT_DATABASE,
  });
  const mvDatabaseName = useWatch({
    control,
    name: `materializedViews.${mvIndex}.databaseName`,
    defaultValue: sourceDatabaseName,
  });
  const mvTableName = useWatch({
    control,
    name: `materializedViews.${mvIndex}.tableName`,
    defaultValue: '',
  });

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

        <Grid.Col span={2}>
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

        <Grid.Col span={1}>
          <Text size="xs" fw={500} mb={4}>
            Minimum Date
            <Tooltip
              label={`(Optional) The earliest date and time (in the local timezone) for which the materialized view contains data. If not provided, then ${brandName} will assume that the materialized view contains data for all dates for which the source table contains data.`}
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
            name={`materializedViews.${mvIndex}.minDate`}
            render={({ field }) => (
              <DateInput
                {...field}
                value={field.value ? new Date(field.value) : undefined}
                onChange={dateStr =>
                  field.onChange(dateStr ? dateStr.toISOString() : null)
                }
                clearable
                highlightToday
                placeholder="YYYY-MM-DD HH:mm:ss"
                valueFormat="YYYY-MM-DD HH:mm:ss"
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
        setValue={setValue}
      />
      <Divider />
    </Stack>
  );
}

/** Component for configuring the Aggregated Columns list for a single materialized view */
function AggregatedColumnsFormSection({
  control,
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

  const kind = useWatch({ control, name: 'kind' });
  const connection = useWatch({ control, name: 'connection' });
  const mvTableName = useWatch({
    control,
    name: `materializedViews.${mvIndex}.tableName`,
  });
  const mvDatabaseName = useWatch({
    control,
    name: `materializedViews.${mvIndex}.databaseName`,
  });
  const fromDatabaseName = useWatch({ control, name: 'from.databaseName' });
  const fromTableName = useWatch({ control, name: 'from.tableName' });
  const prevMvTableNameRef = useRef(mvTableName);

  const metadata = useMetadataWithSettings();

  useEffect(() => {
    (async () => {
      try {
        if (mvTableName !== prevMvTableNameRef.current) {
          prevMvTableNameRef.current = mvTableName;

          if (
            (kind === SourceKind.Log || kind === SourceKind.Trace) &&
            connection &&
            mvDatabaseName &&
            mvTableName &&
            fromDatabaseName &&
            fromTableName
          ) {
            const config = await inferMaterializedViewConfig(
              {
                databaseName: mvDatabaseName,
                tableName: mvTableName,
                connectionId: connection,
              },
              {
                databaseName: fromDatabaseName,
                tableName: fromTableName,
                connectionId: connection,
              },
              metadata,
            );

            if (config) {
              setValue(`materializedViews.${mvIndex}`, config);
              replaceAggregates(config.aggregatedColumns ?? []);
              notifications.show({
                color: 'green',
                id: 'mv-infer-success',
                message:
                  'Partially inferred materialized view configuration from view schema.',
              });
            } else {
              notifications.show({
                color: 'yellow',
                id: 'mv-infer-failure',
                message: 'Unable to infer materialized view configuration.',
              });
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [
    mvTableName,
    kind,
    connection,
    mvDatabaseName,
    fromDatabaseName,
    fromTableName,
    mvIndex,
    replaceAggregates,
    setValue,
    metadata,
  ]);

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
            setValue={setValue}
            control={control}
            mvIndex={mvIndex}
            colIndex={colIndex}
            onRemove={() => removeAggregate(colIndex)}
          />
        ))}
      </Grid>
      <Button size="sm" variant="secondary" onClick={addAggregate} mt="lg">
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
  const sourceDatabaseName = useWatch({
    control,
    name: `from.databaseName`,
    defaultValue: DEFAULT_DATABASE,
  });
  const sourceTableName = useWatch({ control, name: `from.tableName` });
  const mvDatabaseName = useWatch({
    control,
    name: `materializedViews.${mvIndex}.databaseName`,
    defaultValue: sourceDatabaseName,
  });
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
  const { control } = props;
  const brandName = useBrandDisplayName();
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const connectionId = useWatch({ control, name: 'connection' });

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
          helpText={`${brandName} Source for metrics associated with logs. Optional`}
        >
          <SourceSelectControlled control={control} name="metricSourceId" />
        </FormRow>
        <FormRow
          label={'Correlated Trace Source'}
          helpText={`${brandName} Source for traces associated with logs. Optional`}
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
  const { control } = props;
  const brandName = useBrandDisplayName();
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const connectionId = useWatch({ control, name: 'connection' });

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
        helpText={`${brandName} Source for logs associated with traces. Optional`}
      >
        <SourceSelectControlled control={control} name="logSourceId" />
      </FormRow>
      <FormRow
        label={'Correlated Session Source'}
        helpText={`${brandName} Source for sessions associated with traces. Optional`}
      >
        <SourceSelectControlled control={control} name="sessionSourceId" />
      </FormRow>
      <FormRow
        label={'Correlated Metric Source'}
        helpText={`${brandName} Source for metrics associated with traces. Optional`}
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

export function SessionTableModelForm({ control }: TableModelProps) {
  const brandName = useBrandDisplayName();
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const connectionId = useWatch({ control, name: 'connection' });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const prevTableNameRef = useRef(tableName);
  const metadata = useMetadataWithSettings();

  useEffect(() => {
    (async () => {
      try {
        if (tableName && tableName !== prevTableNameRef.current) {
          prevTableNameRef.current = tableName;
          const isValid = await isValidSessionsTable({
            databaseName,
            tableName,
            connectionId,
            metadata,
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
    })();
  }, [tableName, databaseName, connectionId, metadata]);

  return (
    <>
      <Stack gap="sm">
        <FormRow
          label={'Correlated Trace Source'}
          helpText={`${brandName} Source for traces associated with sessions. Required`}
        >
          <SourceSelectControlled control={control} name="traceSourceId" />
        </FormRow>
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
      </Stack>
    </>
  );
}

interface TableModelProps {
  control: Control<TSourceUnion>;
  setValue: UseFormSetValue<TSourceUnion>;
}

export function MetricTableModelForm({ control, setValue }: TableModelProps) {
  const brandName = useBrandDisplayName();
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const connectionId = useWatch({ control, name: 'connection' });
  const metricTables = useWatch({ control, name: 'metricTables' });
  const prevMetricTablesRef = useRef(metricTables);

  const metadata = useMetadataWithSettings();

  useEffect(() => {
    for (const [_key, _value] of Object.entries(OTEL_CLICKHOUSE_EXPRESSIONS)) {
      setValue(_key as any, _value);
    }
  }, [setValue]);

  useEffect(() => {
    (async () => {
      try {
        if (metricTables && prevMetricTablesRef.current) {
          // Check which metric table changed
          for (const metricType of Object.values(MetricsDataType)) {
            const newValue =
              metricTables[metricType as keyof typeof metricTables];
            const prevValue =
              prevMetricTablesRef.current[
                metricType as keyof typeof prevMetricTablesRef.current
              ];

            if (newValue !== prevValue) {
              const isValid = await isValidMetricTable({
                databaseName,
                tableName: newValue as string,
                connectionId,
                metricType: metricType as MetricsDataType,
                metadata,
              });
              if (!isValid) {
                notifications.show({
                  color: 'red',
                  message: `${newValue} is not a valid OTEL ${metricType} schema.`,
                });
              }
            }
          }
        }
        prevMetricTablesRef.current = metricTables;
      } catch (e) {
        console.error(e);
        notifications.show({
          color: 'red',
          message: e.message,
        });
      }
    })();
  }, [metricTables, databaseName, connectionId, metadata]);

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
                ? `Table containing ${metricType.toLowerCase()} metrics data. Note: not yet fully supported by ${brandName}`
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
          helpText={`${brandName} Source for logs associated with metrics. Optional`}
        >
          <SourceSelectControlled control={control} name="logSourceId" />
        </FormRow>
      </Stack>
    </>
  );
}

function TableModelForm({
  control,
  setValue,
  kind,
}: {
  control: Control<TSourceUnion>;
  setValue: UseFormSetValue<TSourceUnion>;
  kind: SourceKind;
}) {
  switch (kind) {
    case SourceKind.Log:
      return <LogTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Trace:
      return <TraceTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Session:
      return <SessionTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Metric:
      return <MetricTableModelForm control={control} setValue={setValue} />;
  }
}

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
    useForm<TSourceUnion>({
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
      // TODO: HDX-1768 remove type assertion
      values: source as TSourceUnion,
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

  const metadata = useMetadataWithSettings();

  useEffect(() => {
    (async () => {
      try {
        if (watchedTableName !== prevTableNameRef.current) {
          prevTableNameRef.current = watchedTableName;

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
        name: keyof TSourceUnion;
        value: string | undefined;
      }> = [];

      if (logSourceId !== prevLogSourceIdRef.current) {
        prevLogSourceIdRef.current = logSourceId;
        changedFields.push({
          name: 'logSourceId' as keyof TSourceUnion,
          value: logSourceId ?? undefined,
        });
      }
      if (traceSourceId !== prevTraceSourceIdRef.current) {
        prevTraceSourceIdRef.current = traceSourceId;
        changedFields.push({
          name: 'traceSourceId' as keyof TSourceUnion,
          value: traceSourceId ?? undefined,
        });
      }
      if (metricSourceId !== prevMetricSourceIdRef.current) {
        prevMetricSourceIdRef.current = metricSourceId;
        changedFields.push({
          name: 'metricSourceId' as keyof TSourceUnion,
          value: metricSourceId ?? undefined,
        });
      }
      if (
        sessionTraceSourceId !== prevSessionTraceSourceIdRef.current &&
        kind === SourceKind.Session
      ) {
        prevSessionTraceSourceIdRef.current = sessionTraceSourceId;
        changedFields.push({
          name: 'traceSourceId' as keyof TSourceUnion,
          value: sessionTraceSourceId ?? undefined,
        });
      }

      for (const {
        name: fieldName,
        value: newTargetSourceId,
      } of changedFields) {
        if (!(fieldName in correlationFields)) continue;

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

  const sourceFormSchema = sourceSchemaWithout({ id: true });
  const handleError = useCallback(
    ({ errors }: z.ZodError<TSourceUnion>, eventName: 'create' | 'save') => {
      const notificationMsgs: string[] = [];

      // eslint-disable-next-line no-console
      console.debug(
        // HDX-3148
        `[${eventName}] SourceForm validation error`,
        JSON.stringify(errors),
      );

      for (const err of errors) {
        const errorPath: string = err.path.join('.');
        // TODO: HDX-1768 get rid of this type assertion if possible
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

  const _onCreate = useCallback(() => {
    clearErrors();
    handleSubmit(async data => {
      const parseResult = sourceFormSchema.safeParse(data);
      if (parseResult.error) {
        handleError(parseResult.error, 'create');
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
        handleError(parseResult.error, 'save');
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
        <Text mb="lg">Source Settings</Text>
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
    </div>
  );
}
