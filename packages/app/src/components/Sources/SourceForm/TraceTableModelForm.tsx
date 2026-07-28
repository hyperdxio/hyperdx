import { Controller, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Divider, Slider, Stack } from '@mantine/core';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useColumns } from '@/hooks/useMetadata';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import { DEFAULT_DATABASE } from './constants';
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
  const { t } = useTranslation('sources');
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
        label={t('fields.timestampColumn')}
        helpText={t('fields.timestampColumnHelpTrace')}
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
        label={t('fields.defaultSelect')}
        helpText={t('fields.defaultSelectHelp')}
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
      <FormRow label={t('fields.durationExpression')}>
        <SQLInlineEditorControlled
          tableConnection={{
            databaseName,
            tableName,
            connectionId,
          }}
          control={control}
          name="durationExpression"
          placeholder={t('fields.durationPlaceholder')}
        />
      </FormRow>
      <FormRow label={t('fields.durationPrecision')}>
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
                    { value: 0, label: t('fields.durationPrecisionSeconds') },
                    {
                      value: 3,
                      label: t('fields.durationPrecisionMillisecond'),
                    },
                    {
                      value: 6,
                      label: t('fields.durationPrecisionMicrosecond'),
                    },
                    {
                      value: 9,
                      label: t('fields.durationPrecisionNanosecond'),
                    },
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
        label={t('fields.traceIdExpression')}
        placeholder="TraceId"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="spanIdExpression"
        label={t('fields.spanIdExpression')}
        placeholder="SpanId"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <FormRow label={t('fields.parentSpanIdExpression')}>
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
      <FormRow label={t('fields.spanNameExpression')}>
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
      <FormRow label={t('fields.spanKindExpression')}>
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
        label={t('fields.correlatedLogSource')}
        helpText={t('fields.correlatedLogSourceHelpTrace', { brandName })}
      >
        <SourceSelectControlled control={control} name="logSourceId" />
      </FormRow>
      <FormRow
        label={t('fields.correlatedSessionSource')}
        helpText={t('fields.correlatedSessionSourceHelpTrace', { brandName })}
      >
        <SourceSelectControlled control={control} name="sessionSourceId" />
      </FormRow>
      <FormRow
        label={t('fields.correlatedMetricSource')}
        helpText={t('fields.correlatedMetricSourceHelpTrace', { brandName })}
      >
        <SourceSelectControlled control={control} name="metricSourceId" />
      </FormRow>
      <FormRow label={t('fields.statusCodeExpression')}>
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
      <FormRow label={t('fields.statusMessageExpression')}>
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
        label={t('fields.serviceNameExpression')}
        placeholder="ServiceName"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="resourceAttributesExpression"
        label={t('fields.resourceAttributesExpression')}
        placeholder="ResourceAttributes"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <ExpressionFormRow
        control={control}
        setValue={setValue}
        name="eventAttributesExpression"
        label={t('fields.eventAttributesExpression')}
        placeholder="SpanAttributes"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <FormRow
        label={t('fields.sampleRateExpression')}
        helpText={t('fields.sampleRateExpressionHelp')}
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
        label={t('fields.spanEventsExpression')}
        helpText={t('fields.spanEventsExpressionHelp')}
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
        label={t('fields.spanLinksExpression')}
        helpText={t('fields.spanLinksExpressionHelp')}
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
        label={t('fields.implicitColumnExpression')}
        helpText={t('fields.implicitColumnExpressionHelp')}
        placeholder="SpanName"
        columns={columns}
        sourceKind={SourceKind.Trace}
        tableConnection={tableConnection}
      />
      <FormRow
        label={t('fields.knownColumnsList')}
        helpText={t('fields.knownColumnsListHelp')}
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
        label={t('fields.displayedTimestampColumn')}
        helpText={t('fields.displayedTimestampColumnHelp')}
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
        label={t('fields.highlightedAttributes')}
        helpText={t('fields.highlightedAttributesHelpTrace')}
      />
      <HighlightedAttributeExpressionsFormRow
        {...props}
        name="highlightedTraceAttributeExpressions"
        label={t('fields.highlightedTraceAttributes')}
        helpText={t('fields.highlightedTraceAttributesHelp')}
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
