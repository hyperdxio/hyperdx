import { useState } from 'react';
import { TableConnection } from '@hyperdx/common-utils/dist/metadata';
import { MetricsDataType, TSource } from '@hyperdx/common-utils/dist/types';
import { Modal, Paper, Tabs, Text, TextProps, Tooltip } from '@mantine/core';

import { useTableMetadata } from '@/hooks/useMetadata';

import { SQLPreview } from './ChartSQLPreview';

interface SourceSchemaInfoIconProps {
  onClick: () => void;
  isEnabled: boolean;
  tableCount: number;
  iconStyles?: Pick<TextProps, 'size' | 'color'>;
}

const SourceSchemaInfoIcon = ({
  onClick,
  isEnabled,
  tableCount,
  iconStyles,
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
      <Text {...iconStyles}>
        <i
          className={`bi bi-code-square ${isEnabled ? 'cursor-pointer' : ''}`}
        />
      </Text>
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
  source?: TSource;
  tableConnection?: TableConnection;
  iconStyles?: Pick<TextProps, 'size' | 'color'>;
}

const METRIC_TYPE_NAMES: Record<MetricsDataType, string> = {
  [MetricsDataType.Sum]: 'Sum',
  [MetricsDataType.Gauge]: 'Gauge',
  [MetricsDataType.Histogram]: 'Histogram',
  [MetricsDataType.Summary]: 'Summary',
  [MetricsDataType.ExponentialHistogram]: 'Exponential Histogram',
};

const SourceSchemaPreview = ({
  source,
  tableConnection,
  iconStyles,
}: SourceSchemaPreviewProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isMetricSource = source?.kind === 'metric';
  const tables: (TableSchemaPreviewProps & { title: string })[] = [];
  if (source && isMetricSource) {
    tables.push(
      ...Object.values(MetricsDataType)
        .map(metricType => ({
          metricType,
          tableName: source.metricTables?.[metricType],
        }))
        .filter(({ tableName }) => !!tableName)
        .map(({ metricType, tableName }) => ({
          databaseName: source.from.databaseName,
          tableName: tableName!,
          connectionId: source.connection,
          title: METRIC_TYPE_NAMES[metricType],
        })),
    );
  } else if (source && source.from.tableName) {
    tables.push({
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
      connectionId: source.connection,
      title: source.name ?? source.from.tableName,
    });
  } else if (tableConnection) {
    tables.push({
      databaseName: tableConnection.databaseName,
      tableName: tableConnection.tableName,
      connectionId: tableConnection.connectionId,
      title: tableConnection.tableName,
    });
  }

  const isEnabled = (!!source || !!tableConnection) && tables.length > 0;

  return (
    <>
      <SourceSchemaInfoIcon
        isEnabled={isEnabled}
        onClick={() => setIsModalOpen(true)}
        iconStyles={iconStyles}
        tableCount={tables.length}
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
