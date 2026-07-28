import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Anchor, Box, Button, Divider, Group, Stack } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';

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

export function LogTableModelForm(props: TableModelProps) {
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

  const [showOptionalFields, setShowOptionalFields] = useState(false);

  return (
    <>
      <Stack gap="sm">
        <FormRow
          label={t('fields.timestampColumn')}
          helpText={t('fields.timestampColumnHelpLog')}
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
                {t('fields.configureOptionalFields')}
              </Group>
            </Anchor>
          )}
          {showOptionalFields && (
            <Button
              onClick={() => setShowOptionalFields(false)}
              size="xs"
              variant="subtle"
            >
              {t('fields.hideOptionalFields')}
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
          label={t('fields.serviceNameExpression')}
          placeholder="ServiceName"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="severityTextExpression"
          label={t('fields.logLevelExpression')}
          placeholder="SeverityText"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="bodyExpression"
          label={t('fields.bodyExpression')}
          placeholder="Body"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="eventAttributesExpression"
          label={t('fields.logAttributesExpression')}
          placeholder="LogAttributes"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="resourceAttributesExpression"
          label={t('fields.resourceAttributesExpression')}
          placeholder="ResourceAttributes"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
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
        <FormRow
          label={t('fields.correlatedMetricSource')}
          helpText={t('fields.correlatedMetricSourceHelpLog', { brandName })}
        >
          <SourceSelectControlled control={control} name="metricSourceId" />
        </FormRow>
        <FormRow
          label={t('fields.correlatedTraceSource')}
          helpText={t('fields.correlatedTraceSourceHelpLog', { brandName })}
        >
          <SourceSelectControlled control={control} name="traceSourceId" />
        </FormRow>

        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="traceIdExpression"
          label={t('fields.traceIdExpression')}
          placeholder="TraceId"
          columns={columns}
          sourceKind={SourceKind.Log}
          tableConnection={tableConnection}
        />
        <ExpressionFormRow
          control={control}
          setValue={setValue}
          name="spanIdExpression"
          label={t('fields.spanIdExpression')}
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
          label={t('fields.implicitColumnExpression')}
          helpText={t('fields.implicitColumnExpressionHelp')}
          placeholder="Body"
          columns={columns}
          sourceKind={SourceKind.Log}
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
        <Divider />
        <HighlightedAttributeExpressionsFormRow
          {...props}
          name="highlightedRowAttributeExpressions"
          label={t('fields.highlightedAttributes')}
          helpText={t('fields.highlightedAttributesHelpLog')}
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
    </>
  );
}
