import { useEffect, useRef } from 'react';
import { useWatch } from 'react-hook-form';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import { Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { useTablesDirect } from '@/clickhouse';
import { DBTableSelectControlled } from '@/components/DBTableSelect';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { isValidMetricTable } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { matchMetricTables } from '@/utils/metricTableAutofill';

import { DEFAULT_DATABASE, OTEL_CLICKHOUSE_EXPRESSIONS } from './constants';
import { FormRow } from './FormRow';
import { TableModelProps } from './types';

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

  // Auto-fill metric table dropdowns by matching table names to metric types.
  // One-shot per database+connection pair: runs once when tables load for a
  // new db/connection, then never re-fires for that pair. No clearing of old
  // values — switching databases naturally empties the dropdowns since the
  // new table list won't contain the old names.
  const { data: tablesData } = useTablesDirect(
    { database: databaseName, connectionId: connectionId ?? '' },
    { enabled: !!databaseName && !!connectionId },
  );

  const lastAutofillKeyRef = useRef('');

  useEffect(() => {
    const key = `${databaseName}:${connectionId}`;
    if (key === lastAutofillKeyRef.current) return; // already ran for this db

    const tableNames = tablesData?.data?.map((t: { name: string }) => t.name);
    if (!tableNames || tableNames.length === 0) return;

    const matched = matchMetricTables(
      tableNames,
      (metricTables as Partial<Record<MetricsDataType, string>>) ?? {},
    );

    const entries = Object.entries(matched) as [MetricsDataType, string][];
    if (entries.length === 0) return;

    // Mark as done before async work so a rapid db switch doesn't double-fire.
    lastAutofillKeyRef.current = key;

    let cancelled = false;

    (async () => {
      // Validate each candidate before setting it, so we never show a
      // green notification followed by red validation errors.
      const validated: [MetricsDataType, string][] = [];
      for (const [metricType, tableName] of entries) {
        if (cancelled) return;
        try {
          const valid = await isValidMetricTable({
            databaseName,
            tableName,
            connectionId,
            metricType,
            metadata,
          });
          if (valid) {
            validated.push([metricType, tableName]);
          }
        } catch {
          // Skip tables that fail validation (e.g. network error)
        }
      }

      if (cancelled || validated.length === 0) return;

      for (const [metricType, tableName] of validated) {
        setValue(`metricTables.${metricType}` as any, tableName);
      }

      notifications.show({
        color: 'green',
        message: 'Auto-detected metric tables from database.',
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesData, databaseName, connectionId, metadata]);

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
