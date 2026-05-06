import React from 'react';
import type {
  GlueColumn,
  GlueTableSchema,
} from '@berg/common-utils/dist/glue/types';
import { Alert, Badge, Code, Group, Stack, Table, Text } from '@mantine/core';
import { IconClock, IconInfoCircle } from '@tabler/icons-react';

/**
 * Auto-detect the most likely event-time column. Prefers TIMESTAMP-typed
 * columns whose name contains `time`, `ts`, or `timestamp`; falls back to
 * the first TIMESTAMP column. Returns undefined if none exist — Berg
 * supports time-optional Sources (Task 9), so the Source schema simply
 * stores `null` in that case.
 */
export function pickRecommendedTimestamp(
  cols: GlueColumn[],
): string | undefined {
  const ts = cols.filter(c => c.type.toLowerCase().startsWith('timestamp'));
  if (ts.length === 0) return undefined;
  if (ts.length === 1) return ts[0].name;
  const named = ts.find(c => /time|ts|timestamp/i.test(c.name));
  return named?.name ?? ts[0]?.name;
}

interface Props {
  schema: GlueTableSchema;
}

export function CatalogTabSchema({ schema }: Props) {
  const recommendedTs = pickRecommendedTimestamp(schema.columns);
  const partitionSet = new Set(schema.partitionKeys);

  return (
    <Stack gap="md">
      {recommendedTs ? (
        <Alert
          icon={<IconClock size={16} />}
          color="blue"
          variant="light"
          title="Recommended timestamp column"
        >
          <Text size="sm">
            <Code>{recommendedTs}</Code> looks like an event-time column. When
            you save this table as a Source, Berg will pre-fill it as the time
            column.
          </Text>
        </Alert>
      ) : (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="gray"
          variant="light"
          title="No timestamp column detected"
        >
          <Text size="sm">
            This table has no TIMESTAMP-typed column. You can still save it as a
            time-optional Source — Search will render a flat row browser instead
            of a histogram.
          </Text>
        </Alert>
      )}

      <Table withTableBorder withColumnBorders verticalSpacing="xs" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Column</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Tags</Table.Th>
            <Table.Th>Comment</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {schema.columns.map(col => (
            <Table.Tr key={col.name}>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={500} ff="monospace">
                    {col.name}
                  </Text>
                </Group>
              </Table.Td>
              <Table.Td>
                <Code>{col.type}</Code>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {col.name === recommendedTs && (
                    <Badge size="xs" color="blue" variant="light">
                      time
                    </Badge>
                  )}
                  {(col.isPartition || partitionSet.has(col.name)) && (
                    <Badge size="xs" color="grape" variant="light">
                      partition
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed">
                  {col.comment ?? ''}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
