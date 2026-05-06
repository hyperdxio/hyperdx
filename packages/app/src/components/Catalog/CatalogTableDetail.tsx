import React, { useState } from 'react';
import Router from 'next/router';
import {
  Alert,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Code,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCode,
  IconColumns,
  IconDeviceFloppy,
  IconInfoCircle,
  IconRowInsertBottom,
  IconSearch,
  IconTerminal2,
} from '@tabler/icons-react';

import { useTableSchema } from '@/hooks/useTableSchema';

import { EditSourceModal } from '../Sources/EditSourceModal';

import { CatalogTabDDL } from './CatalogTabDDL';
import { CatalogTabSample } from './CatalogTabSample';
import { CatalogTabSchema, pickRecommendedTimestamp } from './CatalogTabSchema';
import { CatalogTabStats } from './CatalogTabStats';

export interface CatalogTableDetailProps {
  catalogId: string;
  database: string;
  table: string;
}

function q(id: string) {
  return `"${id.replace(/"/g, '""')}"`;
}

export function CatalogTableDetail({
  catalogId,
  database,
  table,
}: CatalogTableDetailProps) {
  const {
    data: schema,
    isLoading,
    isError,
    error,
  } = useTableSchema(catalogId, database, table);

  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const handleSaveAsSource = () => {
    setSaveModalOpen(true);
  };

  const handleOpenInSearch = () => {
    Router.push({
      pathname: '/search',
      query: { catalog: catalogId, database, table },
    });
  };

  const handleOpenInSQL = () => {
    const sql = `SELECT * FROM ${q(catalogId)}.${q(database)}.${q(table)} LIMIT 100`;
    // The dedicated `/sql` editor route lands later — for now we point at
    // the existing `/clickhouse` page which the v1 plan retains as the SQL
    // workspace. The query-string contract is the same.
    Router.push({ pathname: '/clickhouse', query: { initial: sql } });
  };

  return (
    <Stack gap="md" h="100%">
      <Stack gap={4}>
        <Breadcrumbs separator="/">
          <Text size="sm" c="dimmed">
            {catalogId}
          </Text>
          <Text size="sm" c="dimmed">
            {database}
          </Text>
          <Text size="sm" fw={600}>
            {table}
          </Text>
        </Breadcrumbs>

        {schema && (
          <Group gap={6}>
            <Badge size="sm" variant="light" color="blue">
              {schema.format}
            </Badge>
            <Badge size="sm" variant="light" color="gray">
              {schema.tableType}
            </Badge>
            {schema.partitionKeys.length > 0 && (
              <Badge size="sm" variant="light" color="grape">
                partitioned ({schema.partitionKeys.length})
              </Badge>
            )}
            {schema.location && (
              <Code style={{ fontSize: 10 }}>{schema.location}</Code>
            )}
          </Group>
        )}

        <Group gap="xs" mt={4}>
          <Button
            size="xs"
            variant="primary"
            leftSection={<IconDeviceFloppy size={14} />}
            onClick={handleSaveAsSource}
            disabled={!schema}
          >
            Save as Source
          </Button>
          <Button
            size="xs"
            variant="secondary"
            leftSection={<IconSearch size={14} />}
            onClick={handleOpenInSearch}
          >
            Open in Search
          </Button>
          <Button
            size="xs"
            variant="secondary"
            leftSection={<IconTerminal2 size={14} />}
            onClick={handleOpenInSQL}
          >
            Open in SQL
          </Button>
        </Group>
      </Stack>

      <Box style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {isLoading && (
          <Group gap="xs" py="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading schema…
            </Text>
          </Group>
        )}

        {isError && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            title="Failed to load table schema"
          >
            <Text size="sm">{(error as Error)?.message}</Text>
          </Alert>
        )}

        {schema && saveModalOpen && (
          <EditSourceModal
            opened={saveModalOpen}
            onClose={() => setSaveModalOpen(false)}
            defaults={{
              catalog: catalogId,
              database,
              table,
              displayName: table,
              timestampColumn: pickRecommendedTimestamp(schema.columns),
            }}
          />
        )}

        {schema && (
          <Tabs defaultValue="schema" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="schema" leftSection={<IconColumns size={14} />}>
                Schema
              </Tabs.Tab>
              <Tabs.Tab
                value="sample"
                leftSection={<IconRowInsertBottom size={14} />}
              >
                Sample
              </Tabs.Tab>
              <Tabs.Tab value="ddl" leftSection={<IconCode size={14} />}>
                DDL
              </Tabs.Tab>
              <Tabs.Tab
                value="stats"
                leftSection={<IconInfoCircle size={14} />}
              >
                Stats
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="schema" pt="md">
              <CatalogTabSchema schema={schema} />
            </Tabs.Panel>
            <Tabs.Panel value="sample" pt="md">
              <CatalogTabSample
                catalogId={catalogId}
                database={database}
                table={table}
              />
            </Tabs.Panel>
            <Tabs.Panel value="ddl" pt="md">
              <CatalogTabDDL schema={schema} />
            </Tabs.Panel>
            <Tabs.Panel value="stats" pt="md">
              <CatalogTabStats schema={schema} />
            </Tabs.Panel>
          </Tabs>
        )}
      </Box>
    </Stack>
  );
}

export default CatalogTableDetail;
