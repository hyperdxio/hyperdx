import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Anchor, Box, Button, Divider, Group, Stack } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useColumns } from '@/hooks/useMetadata';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import {
  DEFAULT_DATABASE,
  KNOWN_COLUMNS_EXPRESSION_HELP_TEXT,
} from './constants';
import { ExpressionFormRow } from './ExpressionFormRow';
import { FormRow } from './FormRow';
import { HighlightedAttributeExpressionsFormRow } from './HighlightedAttributes';
import {
  MaterializedViewsFormSection,
  MetadataMaterializedViewsFormSection,
} from './MaterializedViews';
import { OrderByFormRow } from './OrderByFormRow';
import { TableModelProps } from './types';
import { UseTextIndexFormRow } from './UseTextIndexFormRow';

export function LogTableModelForm(props: TableModelProps) {
  const { control, setValue } = props;
  const brandName = useBrandDisplayName();
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const connectionId = useWatch({ control, name: 'connection' });

  const tableConnection = { databaseName, tableName, connectionId };
  const { data: columns } = useColumns({
    databaseName,
    tableName,
    connectionId,
  });

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
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="serviceNameExpression"
          label="Service Name Expression"
          placeholder="ServiceName"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="severityTextExpression"
          label="Log Level Expression"
          placeholder="SeverityText"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="bodyExpression"
          label="Body Expression"
          placeholder="Body"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="eventAttributesExpression"
          label="Log Attributes Expression"
          placeholder="LogAttributes"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="resourceAttributesExpression"
          label="Resource Attributes Expression"
          placeholder="ResourceAttributes"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
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

        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="traceIdExpression"
          label="Trace Id Expression"
          placeholder="TraceId"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="spanIdExpression"
          label="Span Id Expression"
          placeholder="SpanId"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />

        <Divider />
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
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="implicitColumnExpression"
          label="Implicit Column Expression"
          helpText="Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log."
          placeholder="Body"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <FormRow
          label={'Known Columns List'}
          helpText={KNOWN_COLUMNS_EXPRESSION_HELP_TEXT}
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name="knownColumnsListExpression"
            placeholder="Timestamp, Body, ServiceName"
            disableKeywordAutocomplete
          />
        </FormRow>
        <UseTextIndexFormRow control={control} />
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
        <Divider />
        <MetadataMaterializedViewsFormSection {...props} />
        <Divider />
        <OrderByFormRow
          control={control}
          databaseName={databaseName}
          tableName={tableName}
          connectionId={connectionId}
        />
      </Stack>
    </>
  );
}
