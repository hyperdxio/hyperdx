import { useMemo } from 'react';
import isString from 'lodash/isString';
import pickBy from 'lodash/pickBy';
import { TSource } from '@berg/common-utils/dist/types';
import { Accordion, Box, Text } from '@mantine/core';

import { WithClause } from '@/hooks/useRowWhere';

import { getJSONColumnNames, useRowData } from './DBRowDataPanel';
import { DBRowJsonViewer } from './DBRowJsonViewer';
import DBRowSidePanelHeader from './DBRowSidePanelHeader';

// Berg-native row overview: shows the row JSON as a single accordion. The
// HyperDX-specific Resource/Event/SpanEvents accordions are dropped because
// Berg sources have no observability semantics.
export function RowOverviewPanel({
  source,
  rowId,
  aliasWith,
  hideHeader = false,
  'data-testid': dataTestId,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  hideHeader?: boolean;
  'data-testid'?: string;
}) {
  const { data } = useRowData({ source, rowId, aliasWith });

  const jsonColumns = getJSONColumnNames(data?.meta);

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  const allColumns = pickBy(firstRow ?? {}, value => value !== '');

  const mainContent = isString(firstRow?.['__hdx_body'])
    ? firstRow['__hdx_body']
    : firstRow?.['__hdx_body'] !== undefined
      ? JSON.stringify(firstRow['__hdx_body'])
      : undefined;

  return (
    <div className="flex-grow-1 overflow-auto" data-testid={dataTestId}>
      {!hideHeader && (
        <Box px="sm" pt="md">
          <DBRowSidePanelHeader
            attributes={[]}
            date={new Date(firstRow?.__hdx_timestamp ?? 0)}
            mainContent={mainContent}
            mainContentHeader={undefined}
            severityText={firstRow?.__hdx_severity_text}
            rowData={firstRow}
          />
        </Box>
      )}
      <Accordion
        mt="sm"
        defaultValue={['allColumns']}
        multiple
        variant="noPadding"
      >
        {Object.keys(allColumns).length > 0 && (
          <Accordion.Item value="allColumns">
            <Accordion.Control>
              <Text size="sm" ps="md">
                Columns
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Box px="md">
                <DBRowJsonViewer data={allColumns} jsonColumns={jsonColumns} />
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </div>
  );
}
