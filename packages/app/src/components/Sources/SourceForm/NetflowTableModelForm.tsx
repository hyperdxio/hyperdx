import { useWatch } from 'react-hook-form';
import { Stack, Text } from '@mantine/core';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import { DEFAULT_DATABASE } from './constants';
import { FormRow } from './FormRow';
import { TableModelProps } from './types';

const fields = [
  ['timestampValueExpression', 'Timestamp', 'TimeReceived'],
  [
    'defaultTableSelectExpression',
    'Default columns',
    'SrcAddr, DstAddr, Bytes',
  ],
  ['bytesExpression', 'Bytes', 'Bytes'],
  ['packetsExpression', 'Packets', 'Packets'],
  ['srcAddrExpression', 'Source IP address', 'SrcAddr'],
  ['dstAddrExpression', 'Destination IP address', 'DstAddr'],
  ['srcPortExpression', 'Source port', 'SrcPort'],
  ['dstPortExpression', 'Destination port', 'DstPort'],
  ['protocolExpression', 'IP protocol number', 'Proto'],
  ['samplingRateExpression', 'Sampling multiplier (optional)', 'SamplingRate'],
  ['exporterExpression', 'Exporter (optional)', 'ExporterName'],
  ['inIfExpression', 'Input interface (optional)', 'InIfName'],
  ['outIfExpression', 'Output interface (optional)', 'OutIfName'],
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
        data.
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
