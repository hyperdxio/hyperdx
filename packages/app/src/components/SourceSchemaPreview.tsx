import { useState } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/metadata';
import {
  MetricsDataType,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Modal, Paper, Tabs, TextProps, Tooltip } from '@mantine/core';
import { IconCode } from '@tabler/icons-react';

import { useTableMetadata } from '@/hooks/useMetadata';

import { SQLPreview } from './ChartSQLPreview';

interface SourceSchemaInfoIconProps {
  onClick: () => void;
  isEnabled: boolean;
  tableCount: number;
  iconStyles?: Pick<TextProps, 'size' | 'color'>;
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
      c="white"
      position="right"
      onClick={() => isEnabled && onClick()}
    >
      {variant === 'text' ? (
        <span
          style={{ cursor: isEnabled ? 'pointer' : 'default', ...iconStyles }}
        >
          Schema
        </span>
      ) : (
        <IconCode size={16} />
      )}
    </Tooltip>
  );
};

interface TableSchemaPreviewProps {
  databaseName: string;
  tableName: string;
  connectionId: string;
}

const TableSchemaPreview = ({
  databaseName,
  tableName,
  connectionId,
}: TableSchemaPreviewProps) => {
  const { data, isLoading } = useTableMetadata({
    databaseName,
    tableName,
    connectionId,
  });

  return (
    <Paper flex="auto" shadow="none" radius="sm" style={{ overflow: 'hidden' }}>
      {isLoading ? (
        <div className="spin-animate d-inline-block">
          <i className="bi bi-arrow-repeat" />
        </div>
      ) : (
        <SQLPreview
          data={data?.create_table_query ?? 'Schema is not available'}
          enableCopy={!!data?.create_table_query}
        />
      )}
    </Paper>
  );
};

export interface SourceSchemaPreviewProps {
  metricTables?: TMetricSource['metricTables'];
  tableConnection?: TableConnection;
  iconStyles?: Pick<TextProps, 'size' | 'color'>;
  variant?: 'icon' | 'text';
}

const METRIC_TYPE_NAMES: Record<MetricsDataType, string> = {
  [MetricsDataType.Sum]: 'Sum',
  [MetricsDataType.Gauge]: 'Gauge',
  [MetricsDataType.Histogram]: 'Histogram',
  [MetricsDataType.Summary]: 'Summary',
  [MetricsDataType.ExponentialHistogram]: 'Exponential Histogram',
};

const SourceSchemaPreview = ({
  tableConnection,
  iconStyles,
  variant = 'icon',
  metricTables,
}: SourceSchemaPreviewProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const tables: (TableSchemaPreviewProps & { title: string })[] = [];
  if (tableConnection && metricTables) {
    tables.push(
      ...Object.values(MetricsDataType)
        .map(metricType => ({
          metricType,
          tableName: metricTables?.[metricType],
        }))
        .filter(({ tableName }) => !!tableName)
        .map(({ metricType, tableName }) => ({
          databaseName: tableConnection.databaseName,
          tableName: tableName!,
          connectionId: tableConnection.connectionId,
          title: METRIC_TYPE_NAMES[metricType],
        })),
    );
  } else if (tableConnection) {
    tables.push({
      databaseName: tableConnection.databaseName,
      tableName: tableConnection.tableName,
      connectionId: tableConnection.connectionId,
      title: tableConnection.tableName,
    });
  }

  const isEnabled = !!tableConnection && tables.length > 0;

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
