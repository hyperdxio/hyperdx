import { useWatch } from 'react-hook-form';
import { NETFLOW_COLUMN_EXPRESSIONS } from '@hyperdx/common-utils/dist/types';
import { Stack, Text } from '@mantine/core';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import { DEFAULT_DATABASE } from './constants';
import { FormRow } from './FormRow';
import { TableModelProps } from './types';

const fields = [
  ['timestampValueExpression', 'Timestamp', 'TimeReceived'],
  [
    'implicitColumnExpression',
    'Full-text search expression (optional)',
    'Automatic from mapped flow fields',
  ],
  [
    'defaultTableSelectExpression',
    'Default columns',
    'SrcAddr, DstAddr, Bytes',
  ],
  ['bytesExpression', 'Bytes', NETFLOW_COLUMN_EXPRESSIONS.bytesExpression],
  [
    'packetsExpression',
    'Packets',
    NETFLOW_COLUMN_EXPRESSIONS.packetsExpression,
  ],
  [
    'srcAddrExpression',
    'Source IP address',
    NETFLOW_COLUMN_EXPRESSIONS.srcAddrExpression,
  ],
  [
    'dstAddrExpression',
    'Destination IP address',
    NETFLOW_COLUMN_EXPRESSIONS.dstAddrExpression,
  ],
  [
    'srcPortExpression',
    'Source port',
    NETFLOW_COLUMN_EXPRESSIONS.srcPortExpression,
  ],
  [
    'dstPortExpression',
    'Destination port',
    NETFLOW_COLUMN_EXPRESSIONS.dstPortExpression,
  ],
  [
    'protocolExpression',
    'IP protocol number',
    NETFLOW_COLUMN_EXPRESSIONS.protocolExpression,
  ],
  [
    'samplingRateExpression',
    'Sampling multiplier (optional)',
    NETFLOW_COLUMN_EXPRESSIONS.samplingRateExpression,
  ],
  [
    'exporterExpression',
    'Exporter (optional)',
    NETFLOW_COLUMN_EXPRESSIONS.exporterExpression,
  ],
  [
    'inIfExpression',
    'Input interface (optional)',
    NETFLOW_COLUMN_EXPRESSIONS.inIfExpression,
  ],
  [
    'outIfExpression',
    'Output interface (optional)',
    NETFLOW_COLUMN_EXPRESSIONS.outIfExpression,
  ],
] as const;

export function NetflowTableModelForm({ control }: TableModelProps) {
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const connectionId = useWatch({ control, name: 'connection' });

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Map the columns or SQL expressions in your flow table. Akvorado columns
        are detected automatically. Bytes and packets are multiplied by the
        sampling multiplier; leave it blank for unsampled or already scaled
        data. Full-text search uses the mapped flow fields unless overridden.
      </Text>
      {fields.map(([name, label, placeholder]) => (
        <FormRow key={name} label={<Text size="sm">{label}</Text>}>
          <SQLInlineEditorControlled
            control={control}
            name={name}
            placeholder={placeholder}
            tableConnection={{ databaseName, tableName, connectionId }}
            disableKeywordAutocomplete
          />
        </FormRow>
      ))}
    </Stack>
  );
}
