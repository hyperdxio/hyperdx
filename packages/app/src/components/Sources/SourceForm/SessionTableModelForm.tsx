import { useEffect, useRef } from 'react';
import { useWatch } from 'react-hook-form';
import { Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { isValidSessionsTable } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import { DEFAULT_DATABASE } from './constants';
import { FormRow } from './FormRow';
import { TableModelProps } from './types';

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
      </Stack>
    </>
  );
}
