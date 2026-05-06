import React, { useMemo } from 'react';
import type { GlueTableSchema } from '@berg/common-utils/dist/glue/types';
import { Alert, Badge, Code, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import { useRunQuery } from '@/hooks/useRunQuery';

interface Props {
  schema: GlueTableSchema;
}

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

export function CatalogTabStats({ schema }: Props) {
  const sql = useMemo(
    () =>
      `SELECT count(*) AS row_count FROM ${q(schema.catalogId)}.${q(schema.database)}.${q(schema.table)}`,
    [schema.catalogId, schema.database, schema.table],
  );

  const { data, isFetching, isError, error } = useRunQuery({
    key: `stats:${schema.catalogId}/${schema.database}/${schema.table}`,
    sql,
  });

  const rowCount = (data?.rows[0]?.row_count ?? null) as number | string | null;

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Storage
        </Text>
        <Group gap="md">
          <StatItem label="Format">
            <Badge variant="light" color="blue">
              {schema.format}
            </Badge>
          </StatItem>
          <StatItem label="Table type">
            <Badge variant="light" color="gray">
              {schema.tableType}
            </Badge>
          </StatItem>
        </Group>
        <StatItem label="Location">
          <Code style={{ fontSize: 11 }}>{schema.location || '—'}</Code>
        </StatItem>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Partitioning
        </Text>
        {schema.partitionKeys.length === 0 ? (
          <Text size="sm" c="dimmed">
            Not partitioned.
          </Text>
        ) : (
          <Group gap={4}>
            {schema.partitionKeys.map(p => (
              <Badge key={p} variant="light" color="grape">
                {p}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Row count
        </Text>
        {isFetching && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Counting…
            </Text>
          </Group>
        )}
        {isError && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="red"
            variant="light"
          >
            <Text size="xs">
              {(error as Error)?.message ?? 'Count query failed'}
            </Text>
          </Alert>
        )}
        {data && data.status === 'finished' && (
          <Text size="lg" fw={600}>
            {rowCount === null ? '—' : Number(rowCount).toLocaleString()}
          </Text>
        )}
        {data && data.status !== 'finished' && (
          <Text size="sm" c="dimmed">
            Status: {data.status}
          </Text>
        )}
        {data && (
          <Text size="xs" c="dimmed">
            Scanned {formatBytes(data.scannedBytes)}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

function StatItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Group gap={6} align="center">
      <Text size="xs" c="dimmed" w={90}>
        {label}
      </Text>
      {children}
    </Group>
  );
}
