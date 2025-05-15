import * as React from 'react';
import Drawer from 'react-modern-drawer';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { Card, Stack, Text } from '@mantine/core';

import { RawLogTable } from '@/components/DBRowTable';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { Pattern } from '@/hooks/usePatterns';
import {
  PATTERN_COLUMN_ALIAS,
  TIMESTAMP_COLUMN_ALIAS,
} from '@/hooks/usePatterns';
import { useZIndex, ZIndexContext } from '@/zIndex';

import styles from '../../styles/LogSidePanel.module.scss';

export default function PatternSidePanel({
  isOpen,
  onClose,
  pattern,
  serviceNameExpression = 'Service',
}: {
  isOpen: boolean;
  onClose: () => void;
  pattern: Pattern;
  serviceNameExpression?: string;
}) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 100;

  const columnTypeMap = React.useMemo(() => {
    const map = new Map<string, { _type: JSDataType | null }>([
      [TIMESTAMP_COLUMN_ALIAS, { _type: JSDataType.Date }],
      [PATTERN_COLUMN_ALIAS, { _type: JSDataType.String }],
      [serviceNameExpression, { _type: JSDataType.String }],
    ]);
    return map;
  }, [serviceNameExpression]);

  const columnNameMap = React.useMemo(() => {
    return {
      [TIMESTAMP_COLUMN_ALIAS]: 'Timestamp',
      [serviceNameExpression]: 'Service',
      [PATTERN_COLUMN_ALIAS]: 'Message',
    };
  }, [serviceNameExpression]);

  const displayedColumns = React.useMemo(() => {
    return [
      TIMESTAMP_COLUMN_ALIAS,
      serviceNameExpression,
      PATTERN_COLUMN_ALIAS,
    ];
  }, [serviceNameExpression]);

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      direction="right"
      size="70vw"
      zIndex={drawerZIndex}
      enableOverlay={true}
      overlayOpacity={0.1}
      duration={0}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <DrawerHeader header="Pattern" onClose={onClose} />
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
                  isLoading={false}
                  fetchNextPage={() => {}}
                  onRowExpandClick={() => {}}
                  wrapLines={false}
                  highlightedLineId={''}
                  hasNextPage={false}
                  isLive={false}
                />
              </Card>
            </Stack>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
