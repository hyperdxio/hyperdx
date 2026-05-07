import React, { useState } from 'react';
import type { GlueTableSchema } from '@berg/common-utils/dist/glue/types';
import { TSource } from '@berg/common-utils/dist/types';
import { Modal, Paper, Tabs, Text, Tooltip } from '@mantine/core';
import { IconCode, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

import { CatalogTabDDL } from './Catalog/CatalogTabDDL';

interface SourceSchemaInfoIconProps {
  onClick: () => void;
  isEnabled: boolean;
  tableCount: number;
  iconStyles?: React.CSSProperties;
  variant?: 'icon' | 'text';
}

const SourceSchemaInfoIcon = ({
  onClick,
  isEnabled,
  tableCount,
  iconStyles,
  variant = 'icon',
}: SourceSchemaInfoIconProps) => {
  const tooltipText = isEnabled
    ? tableCount > 1
      ? `Show Table Schemas`
      : 'Show Table Schema'
    : 'Select a table to view its schema';

  return (
    <Tooltip
      label={tooltipText}
      color="dark"
      position="right"
      onClick={() => isEnabled && onClick()}
    >
      {variant === 'text' ? (
        <Text
          fw={500}
          size="xs"
          className="text-sucess-hover"
          style={{ cursor: isEnabled ? 'pointer' : 'default', ...iconStyles }}
        >
          Schema
        </Text>
      ) : (
        <IconCode size={16} />
      )}
    </Tooltip>
  );
};

interface TableSchemaPreviewProps {
  catalogId: string;
  databaseName: string;
  tableName: string;
}

/**
 * Render a Glue-derived schema view for a Berg source. CH had a
 * canonical `create_table_query` per row in `system.tables`; on Athena
 * the equivalent is `SHOW CREATE TABLE`, which requires running a real
 * query. To keep this surface read-only we synthesize best-effort DDL
 * from the Glue table metadata — same component the Catalog page uses.
 */
const TableSchemaPreview = ({
  catalogId,
  databaseName,
  tableName,
}: TableSchemaPreviewProps) => {
  const { data, isLoading, error } = useQuery<GlueTableSchema, Error>({
    queryKey: ['sourceSchemaPreview', { catalogId, databaseName, tableName }],
    queryFn: async () => {
      const url = `/api/v1/catalogs/${encodeURIComponent(
        catalogId,
      )}/databases/${encodeURIComponent(
        databaseName,
      )}/tables/${encodeURIComponent(tableName)}/schema`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Schema fetch failed (${res.status}): ${body}`);
      }
      return res.json();
    },
    enabled: !!catalogId && !!databaseName && !!tableName,
    staleTime: 1000 * 60,
  });

  return (
    <Paper
      flex="auto"
      shadow="none"
      radius="sm"
      p="xs"
      style={{ overflow: 'hidden' }}
    >
      {isLoading ? (
        <div className="d-inline-block">
          <IconRefresh className="spin-animate" />
        </div>
      ) : error ? (
        <Text size="sm" c="red">
          {error.message}
        </Text>
      ) : data ? (
        <CatalogTabDDL schema={data} />
      ) : (
        <Text size="sm" c="dimmed">
          Schema is not available
        </Text>
      )}
    </Paper>
  );
};

interface SourceSchemaPreviewProps {
  source?: Pick<
    TSource,
    'catalog' | 'database' | 'table' | 'displayName' | 'kind'
  >;
  iconStyles?: React.CSSProperties;
  variant?: 'icon' | 'text';
}

const SourceSchemaPreview = ({
  source,
  iconStyles,
  variant = 'icon',
}: SourceSchemaPreviewProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const tables: (TableSchemaPreviewProps & { title: string })[] = [];
  const databaseName = source?.database;
  const tableName = source?.table;
  const catalogId = source?.catalog;
  if (source && tableName && catalogId) {
    tables.push({
      catalogId,
      databaseName: databaseName ?? '',
      tableName,
      title: source.displayName ?? tableName,
    });
  }

  const isEnabled = !!source && tables.length > 0;

  return (
    <>
      <SourceSchemaInfoIcon
        isEnabled={isEnabled}
        onClick={() => setIsModalOpen(true)}
        iconStyles={iconStyles}
        tableCount={tables.length}
        variant={variant}
      />
      {isEnabled && (
        <Modal
          opened={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          size="auto"
          title={tables.length > 1 ? `Table Schemas` : `Table Schema`}
        >
          <Tabs
            defaultValue={`${tables[0]?.databaseName}.${tables[0]?.tableName}.${tables[0]?.title}`}
          >
            <Tabs.List>
              {tables.map(table => (
                <Tabs.Tab
                  key={`${table.databaseName}.${table.tableName}.${table.title}`}
                  value={`${table.databaseName}.${table.tableName}.${table.title}`}
                >
                  {table.title}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {tables.map(table => (
              <Tabs.Panel
                key={`${table.databaseName}.${table.tableName}.${table.title}`}
                value={`${table.databaseName}.${table.tableName}.${table.title}`}
                pt="sm"
              >
                <TableSchemaPreview {...table} />
              </Tabs.Panel>
            ))}
          </Tabs>
        </Modal>
      )}
    </>
  );
};

export default SourceSchemaPreview;
