import React, { useState } from 'react';
import {
  MetricsDataType,
  TLogSource,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Modal, Paper, Stack, Tabs, Text, Tooltip } from '@mantine/core';
import { IconCode, IconRefresh } from '@tabler/icons-react';

import { useTableMetadata } from '@/hooks/useMetadata';

import { SQLPreview } from './ChartSQLPreview';

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
          className="text-success-hover"
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
      ) : (
        <Stack gap="sm">
          {data?.create_local_table_query && (
            <Text size="xs" fw={600} c="dimmed">
              Distributed Table
            </Text>
          )}
          <SQLPreview
            data={data?.create_table_query ?? 'Schema is not available'}
            enableCopy={!!data?.create_table_query}
            copyButtonSize="xs"
          />
          {data?.create_local_table_query && (
            <>
              <Text size="xs" fw={600} c="dimmed">
                Local Table
              </Text>
              <SQLPreview
                data={data.create_local_table_query}
                enableCopy
                copyButtonSize="xs"
              />
            </>
          )}
        </Stack>
      )}
    </Paper>
  );
};

interface SourceSchemaPreviewSource {
  connection: TSource['connection'];
  from: TSource['from'];
  metricTables?: TMetricSource['metricTables'];
  kind?: TSource['kind'];
  name?: TSource['name'];
  materializedViews?: TLogSource['materializedViews'];
}

interface SourceSchemaPreviewProps {
  source?: SourceSchemaPreviewSource;
  iconStyles?: React.CSSProperties;
  variant?: 'icon' | 'text';
  /**
   * When true, the trigger element (icon or text button) is NOT rendered;
   * the parent owns open state and drives the modal via `open` / `onClose`.
   * Useful when the trigger lives outside this component (e.g. a kebab menu
   * adjacent to a source picker).
   */
  controlled?: boolean;
  open?: boolean;
  onClose?: () => void;
}

const METRIC_TYPE_NAMES: Record<MetricsDataType, string> = {
  [MetricsDataType.Sum]: 'Sum',
  [MetricsDataType.Gauge]: 'Gauge',
  [MetricsDataType.Histogram]: 'Histogram',
  [MetricsDataType.Summary]: 'Summary',
  [MetricsDataType.ExponentialHistogram]: 'Exponential Histogram',
};

/**
 * Build the list of tables (and their titles) to show in the schema preview
 * modal for a given source. Internal helper that powers both
 * `<SourceSchemaPreview>` rendering and `isSourceSchemaPreviewEnabled`,
 * so callers can decide whether the preview has anything to show before
 * rendering a trigger.
 */
function getSourceSchemaTables(
  source?: SourceSchemaPreviewSource,
): (TableSchemaPreviewProps & { title: string })[] {
  const tables: (TableSchemaPreviewProps & { title: string })[] = [];
  if (!source) return tables;

  const isMetricSource = source.kind === 'metric';
  if (isMetricSource) {
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
  } else if (source.from.tableName) {
    tables.push({
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
      connectionId: source.connection,
      title: source.name ?? source.from.tableName,
    });
  }

  const mvConfigs = source.materializedViews ?? [];
  tables.push(
    ...mvConfigs.map(({ tableName, databaseName }) => ({
      databaseName,
      tableName,
      connectionId: source.connection,
      title: `${tableName} (MV)`,
    })),
  );

  return tables;
}

export function isSourceSchemaPreviewEnabled(
  source?: SourceSchemaPreviewSource,
): boolean {
  return !!source && getSourceSchemaTables(source).length > 0;
}

const SourceSchemaPreview = ({
  source,
  iconStyles,
  variant = 'icon',
  controlled = false,
  open,
  onClose,
}: SourceSchemaPreviewProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isModalOpen = controlled ? !!open : internalOpen;
  const handleClose = () => {
    if (controlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
  };

  const tables = getSourceSchemaTables(source);
  const isEnabled = isSourceSchemaPreviewEnabled(source);

  return (
    <>
      {!controlled && (
        <SourceSchemaInfoIcon
          isEnabled={isEnabled}
          onClick={() => setInternalOpen(true)}
          iconStyles={iconStyles}
          tableCount={tables.length}
          variant={variant}
        />
      )}
      {isEnabled && (
        <Modal
          opened={isModalOpen}
          onClose={handleClose}
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
