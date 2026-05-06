import React, { useMemo } from 'react';
import {
  Alert,
  Code,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import { useRunQuery } from '@/hooks/useRunQuery';

interface Props {
  catalogId: string;
  database: string;
  table: string;
}

/**
 * Quote a Trino identifier safely for a SELECT, matching the emitter from
 * Task 5. Keeps this component self-contained — no shared SQL builder
 * import — because the Sample / Stats tabs are the only consumers.
 */
function q(id: string) {
  return `"${id.replace(/"/g, '""')}"`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function renderCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined)
    return (
      <Text size="xs" c="dimmed" fs="italic">
        null
      </Text>
    );
  if (typeof value === 'object') return <Code>{JSON.stringify(value)}</Code>;
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

export function CatalogTabSample({ catalogId, database, table }: Props) {
  const sql = useMemo(
    () => `SELECT * FROM ${q(catalogId)}.${q(database)}.${q(table)} LIMIT 50`,
    [catalogId, database, table],
  );

  const { data, isFetching, isError, error } = useRunQuery({
    key: `sample:${catalogId}/${database}/${table}`,
    sql,
  });

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Code style={{ fontSize: 11 }}>{sql}</Code>
        {data && (
          <Text size="xs" c="dimmed">
            {data.rows.length} rows · scanned {formatBytes(data.scannedBytes)}
          </Text>
        )}
      </Group>

      {isFetching && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Running…
          </Text>
        </Group>
      )}

      {isError && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="red"
          variant="light"
          title="Query failed"
        >
          <Text size="xs">{(error as Error)?.message ?? 'Unknown error'}</Text>
        </Alert>
      )}

      {data && data.status !== 'finished' && (
        <Alert color="yellow" variant="light">
          Query status: {data.status}. The sample is empty until the query
          finishes — Task 9 adds polling for long-running queries.
        </Alert>
      )}

      {data && data.rows.length > 0 && (
        <ScrollArea>
          <Table withTableBorder withColumnBorders verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                {data.schema.map(c => (
                  <Table.Th key={c.name}>
                    <Stack gap={0}>
                      <Text size="xs" fw={600} ff="monospace">
                        {c.name}
                      </Text>
                      <Text size="9px" c="dimmed">
                        {c.type}
                      </Text>
                    </Stack>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.map((row, i) => (
                <Table.Tr key={i}>
                  {data.schema.map(c => (
                    <Table.Td key={c.name}>{renderCell(row[c.name])}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {data && data.status === 'finished' && data.rows.length === 0 && (
        <Text size="sm" c="dimmed">
          Query returned no rows.
        </Text>
      )}
    </Stack>
  );
}
