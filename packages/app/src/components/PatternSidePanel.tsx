import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Card, Drawer, Stack, Text } from '@mantine/core';

import { IsolatedChartSyncProvider } from '@/chartSync';
// Easter egg: April Fools 2026 — see aiSummarize/ for details.
import AISummarizePatternButton from '@/components/AISummarizePatternButton';
import DBRowSidePanel from '@/components/DBRowSidePanel';
import { RawLogTable } from '@/components/DBRowTable';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { Pattern } from '@/hooks/usePatterns';
import {
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
  TIMESTAMP_COLUMN_ALIAS,
} from '@/hooks/usePatterns';
import useRowWhere, { RowWhereResult } from '@/hooks/useRowWhere';
import { getFirstTimestampValueExpression } from '@/source';
import { useZIndex, ZIndexContext } from '@/zIndex';

import styles from '@styles/LogSidePanel.module.scss';

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
  const { t } = useTranslation('search');
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 100;

  const [selectedRowWhere, setSelectedRowWhere] =
    React.useState<RowWhereResult | null>(null);

  const serviceNameExpression =
    ((source?.kind === SourceKind.Log || source?.kind === SourceKind.Trace) &&
      source.serviceNameExpression) ||
    'Service';

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
      [TIMESTAMP_COLUMN_ALIAS]: t('patterns.timestamp'),
      [serviceNameExpression]: t('patterns.service'),
      [SEVERITY_TEXT_COLUMN_ALIAS]: 'level',
      [PATTERN_COLUMN_ALIAS]: t('patterns.body'),
    };
  }, [serviceNameExpression, t]);

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
      const rowWhereResult = getRowWhere({
        body: row[PATTERN_COLUMN_ALIAS],
        ts: row[TIMESTAMP_COLUMN_ALIAS],
      });
      setSelectedRowWhere(rowWhereResult);
    },
    [getRowWhere],
  );

  const INITIAL_LIMIT = 100;
  const [showAll, setShowAll] = React.useState(false);

  React.useEffect(() => {
    setShowAll(false);
  }, [pattern]);

  const displayedSamples = React.useMemo(() => {
    if (showAll || pattern.samples.length <= INITIAL_LIMIT) {
      return pattern.samples;
    }
    return pattern.samples.slice(0, INITIAL_LIMIT);
  }, [pattern.samples, showAll]);

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
        <IsolatedChartSyncProvider>
          <div className={styles.panel}>
            <DrawerHeader
              header={t('patterns.title')}
              onClose={selectedRowWhere ? handleCloseRowSidePanel : onClose}
            />
            <DrawerBody>
              <Stack>
                <Card p="md">
                  <Text size="sm">{pattern.pattern}</Text>
                  <AISummarizePatternButton
                    pattern={pattern}
                    serviceNameExpression={serviceNameExpression}
                  />
                </Card>
                <Card p="md">
                  <Card.Section p="md" py="xs">
                    {t('patterns.sampleEvents', {
                      displayCount: pattern.count?.toLocaleString(),
                    })}
                  </Card.Section>
                  <RawLogTable
                    rows={displayedSamples}
                    generateRowId={row => ({ where: row.id, aliasWith: [] })}
                    displayedColumns={displayedColumns}
                    columnTypeMap={columnTypeMap}
                    columnNameMap={columnNameMap}
                    onRowDetailsClick={handleRowClick}
                    wrapLines={false}
                    showExpandButton={false}
                    isLive={false}
                  />
                  {!showAll && pattern.samples.length > INITIAL_LIMIT && (
                    <Button
                      variant="subtle"
                      fullWidth
                      size="xs"
                      mt="xs"
                      onClick={() => setShowAll(true)}
                    >
                      {t('patterns.showAllSamples', {
                        displayCount: pattern.samples.length.toLocaleString(),
                      })}
                    </Button>
                  )}
                </Card>
              </Stack>
            </DrawerBody>
            {selectedRowWhere && (
              <DBRowSidePanel
                source={source}
                rowId={selectedRowWhere.where}
                aliasWith={selectedRowWhere.aliasWith}
                onClose={handleCloseRowSidePanel}
              />
            )}
          </div>
        </IsolatedChartSyncProvider>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
