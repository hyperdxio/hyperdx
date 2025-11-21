import * as React from 'react';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Card, Drawer, Stack, Text } from '@mantine/core';

import DBRowSidePanel from '@/components/DBRowSidePanel';
import { RawLogTable } from '@/components/DBRowTable';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { Pattern } from '@/hooks/usePatterns';
import {
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
  TIMESTAMP_COLUMN_ALIAS,
} from '@/hooks/usePatterns';
import useRowWhere from '@/hooks/useRowWhere';
import { getFirstTimestampValueExpression } from '@/source';
import { useZIndex, ZIndexContext } from '@/zIndex';

import styles from '../../styles/LogSidePanel.module.scss';

export default function PatternSidePanel({
  isOpen,
  onClose,
  pattern,
  bodyValueExpression,
  source,
}: {
  isOpen: boolean;
  onClose: () => void;
  pattern: Pattern;
  bodyValueExpression: string;
  source: TSource;
}) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 100;

  const [selectedRowWhere, setSelectedRowWhere] = React.useState<string | null>(
    null,
  );

  const serviceNameExpression = source?.serviceNameExpression || 'Service';

  const columnTypeMap = React.useMemo(() => {
    const map = new Map<string, { _type: JSDataType | null }>([
      [TIMESTAMP_COLUMN_ALIAS, { _type: JSDataType.Date }],
      [PATTERN_COLUMN_ALIAS, { _type: JSDataType.String }],
      [SEVERITY_TEXT_COLUMN_ALIAS, { _type: JSDataType.String }],
      [serviceNameExpression, { _type: JSDataType.String }],
    ]);
    return map;
  }, [serviceNameExpression]);

  const columnNameMap = React.useMemo(() => {
    return {
      [TIMESTAMP_COLUMN_ALIAS]: 'Timestamp',
      [serviceNameExpression]: 'Service',
      [SEVERITY_TEXT_COLUMN_ALIAS]: 'level',
      [PATTERN_COLUMN_ALIAS]: 'Body',
    };
  }, [serviceNameExpression]);

  const displayedColumns = React.useMemo(() => {
    return [
      TIMESTAMP_COLUMN_ALIAS,
      serviceNameExpression,
      SEVERITY_TEXT_COLUMN_ALIAS,
      PATTERN_COLUMN_ALIAS,
    ];
  }, [serviceNameExpression]);

  const getRowWhere = useRowWhere({
    meta: [
      { name: 'body', type: 'String' },
      { name: 'ts', type: 'DateTime64(9)' },
    ],
    aliasMap: {
      body: bodyValueExpression,
      ts: getFirstTimestampValueExpression(source.timestampValueExpression),
    },
  });

  const handleRowClick = React.useCallback(
    (row: Record<string, any>) => {
      const whereClause = getRowWhere({
        body: row[PATTERN_COLUMN_ALIAS],
        ts: row[TIMESTAMP_COLUMN_ALIAS],
      });
      setSelectedRowWhere(whereClause);
    },
    [getRowWhere],
  );

  const handleCloseRowSidePanel = React.useCallback(() => {
    setSelectedRowWhere(null);
  }, []);

  return (
    <Drawer
      opened={isOpen}
      onClose={selectedRowWhere ? handleCloseRowSidePanel : onClose}
      position="right"
      size="70vw"
      withCloseButton={false}
      zIndex={drawerZIndex}
      styles={{
        body: {
          padding: 0,
        },
      }}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <DrawerHeader
            header="Pattern"
            onClose={selectedRowWhere ? handleCloseRowSidePanel : onClose}
          />
          <DrawerBody>
            <Stack>
              <Card p="md">
                <Text size="sm">{pattern.pattern}</Text>
              </Card>
              <Card p="md">
                <Card.Section p="md" py="xs">
                  ~{pattern.count?.toLocaleString()} Sample Events
                </Card.Section>
                <RawLogTable
                  rows={pattern.samples}
                  generateRowId={row => row.id}
                  displayedColumns={displayedColumns}
                  columnTypeMap={columnTypeMap}
                  columnNameMap={columnNameMap}
                  onRowDetailsClick={handleRowClick}
                  wrapLines={false}
                  showExpandButton={false}
                  isLive={false}
                />
              </Card>
            </Stack>
          </DrawerBody>
          {selectedRowWhere && (
            <DBRowSidePanel
              source={source}
              rowId={selectedRowWhere}
              onClose={handleCloseRowSidePanel}
              isNestedPanel={true}
              breadcrumbPath={[{ label: 'Pattern Overview' }]}
            />
          )}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
