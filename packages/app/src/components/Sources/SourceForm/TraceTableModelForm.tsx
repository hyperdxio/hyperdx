import { Controller, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Divider, Slider, Stack } from '@mantine/core';

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

export function TraceTableModelForm(props: TableModelProps) {
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
                  // Mantine 9's Slider styles use the pattern
                  // `:where([data-orientation="vertical"]) .<part>`,
                  // which matches when ANY ancestor has
                  // `data-orientation="vertical"`. Mantine Card sets
                  // `data-orientation="vertical"` by default, and the
                  // SourceForm renders inside a Card, so the slider's
                  // trackContainer/track/bar/thumb/markWrapper/
                  // markLabel all pick up the vertical-orientation
                  // styling: the track collapses to 8px wide and the
                  // four marks stack on top of each other. Override
                  // every affected part back to its horizontal
                  // default so the slider renders correctly inside
                  // the Card.
                  styles={{
                    trackContainer: {
                      width: '100%',
                      flexDirection: 'row',
                      height: 'calc(var(--slider-size) * 2)',
                    },
                    track: {
                      width: '100%',
                      height: 'var(--slider-size)',
                    },
                    bar: {
                      top: 0,
                      bottom: 0,
                      height: '100%',
                      insetInlineStart: 'var(--slider-bar-offset)',
                      width: 'var(--slider-bar-width)',
                    },
                    thumb: {
                      left: 'var(--slider-thumb-offset)',
                      top: '50%',
                      right: 'auto',
                      bottom: 'auto',
                      transform: 'translate(-50%, -50%)',
                    },
                    markWrapper: {
                      insetInlineStart:
                        'calc(var(--mark-offset) - var(--slider-size) / 2)',
                      top: 0,
                      bottom: 'auto',
                      width: 'auto',
                    },
                    markLabel: {
                      transform:
                        'translate(calc(-50% + var(--slider-size) / 2), calc(var(--mantine-spacing-xs) / 2))',
                    },
                    label: {
                      top: '-36px',
                      insetInlineStart: 'auto',
                    },
                  }}
                />
              </div>
            )}
          />
        </Box>
      </FormRow>
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="traceIdExpression"
        label="Trace Id Expression"
        placeholder="TraceId"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="spanIdExpression"
        label="Span Id Expression"
        placeholder="SpanId"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
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
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="serviceNameExpression"
        label="Service Name Expression"
        placeholder="ServiceName"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="resourceAttributesExpression"
        label="Resource Attributes Expression"
        placeholder="ResourceAttributes"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="eventAttributesExpression"
        label="Event Attributes Expression"
        placeholder="SpanAttributes"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <FormRow
        label={'Sample Rate Expression'}
        helpText="Column or expression for upstream sampling weight (1/N). When set, aggregations (count, avg, sum, quantile) are corrected for sampling. Percentiles use quantileTDigestWeighted, which is an approximation -- exact values may differ slightly. Leave empty if spans are not sampled."
      >
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="sampleRateExpression"
          placeholder="SampleRate"
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
        label={'Span Links Expression'}
        helpText="Expression to extract span links. Used to capture links from a span to spans in other traces. Expected to be Nested ( TraceId String, SpanId String, TraceState String, Attributes Map(LowCardinality(String), String) )"
      >
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="spanLinksValueExpression"
          placeholder="Links"
        />
      </FormRow>
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="implicitColumnExpression"
        label="Implicit Column Expression"
        helpText="Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log."
        placeholder="SpanName"
        columns={columns}
        sourceKind={SourceKind.Trace}
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
  );
}
