import { useCallback, useContext, useMemo } from 'react';
import isString from 'lodash/isString';
import pickBy from 'lodash/pickBy';
import { SourceKind, TSource } from '@berg/common-utils/dist/types';
import { Accordion, Box, Flex, Text } from '@mantine/core';

import { WithClause } from '@/hooks/useRowWhere';
import { getEventBody } from '@/source';
import { getHighlightedAttributesFromData } from '@/utils/highlightedAttributes';

import { getJSONColumnNames, useRowData } from './DBRowDataPanel';
import { DBRowJsonViewer } from './DBRowJsonViewer';
import { RowSidePanelContext } from './DBRowSidePanel';
import DBRowSidePanelHeader from './DBRowSidePanelHeader';
import EventTag from './EventTag';

const EMPTY_OBJ = {};
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
  const { onPropertyAddClick, generateSearchUrl } =
    useContext(RowSidePanelContext);

  const highlightedAttributeValues = useMemo(() => {
    const attributeExpressions =
      source.kind === SourceKind.Trace || source.kind === SourceKind.Log
        ? (source.highlightedRowAttributeExpressions ?? [])
        : [];

    return data
      ? getHighlightedAttributesFromData(
          source,
          attributeExpressions,
          data.data || [],
          data.meta || [],
        )
      : [];
  }, [source, data]);

  const jsonColumns = getJSONColumnNames(data?.meta);

  const eventAttributesExpr =
    source.kind === SourceKind.Log || source.kind === SourceKind.Trace
      ? source.eventAttributesExpression
      : undefined;

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  // TODO: Use source config to select these in SQL, but we'll just
  // assume OTel column names for now
  const topLevelAttributeKeys = [
    'ServiceName',
    'SpanName',
    'Duration',
    'SeverityText',
    'StatusCode',
    'StatusMessage',
    'SpanKind',
    'TraceId',
    'SpanId',
    'ParentSpanId',
    'ScopeName',
    'ScopeVersion',
  ];
  const topLevelAttributes = pickBy(firstRow, (value, key) => {
    if (value === '') {
      return false;
    }
    if (topLevelAttributeKeys.includes(key)) {
      return true;
    }
    return false;
  });

  const resourceAttributes = firstRow?.__hdx_resource_attributes ?? EMPTY_OBJ;

  const dataAttributes = useMemo(
    () =>
      eventAttributesExpr &&
      firstRow?.[eventAttributesExpr] &&
      Object.keys(firstRow[eventAttributesExpr]).length > 0
        ? { [eventAttributesExpr]: firstRow[eventAttributesExpr] }
        : {},
    [eventAttributesExpr, firstRow],
  );

  const _generateSearchUrl = useCallback(
    (query?: string, queryLanguage?: 'sql' | 'lucene') => {
      return (
        generateSearchUrl?.({
          where: query,
          whereLanguage: queryLanguage,
        }) ?? '/'
      );
    },
    [generateSearchUrl],
  );

  const filteredEventAttributes = useMemo(() => {
    return dataAttributes;
  }, [dataAttributes]);

  const mainContentColumn = getEventBody(source);
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
            attributes={highlightedAttributeValues}
            date={new Date(firstRow?.__hdx_timestamp ?? 0)}
            mainContent={mainContent}
            mainContentHeader={mainContentColumn}
            severityText={firstRow?.__hdx_severity_text}
            rowData={firstRow}
          />
        </Box>
      )}
      <Accordion
        mt="sm"
        defaultValue={[
          'exception',
          'spanEvents',
          'network',
          'resourceAttributes',
          'eventAttributes',
          'topLevelAttributes',
        ]}
        multiple
        variant="noPadding"
      >
        {Object.keys(topLevelAttributes).length > 0 && (
          <Accordion.Item value="topLevelAttributes">
            <Accordion.Control>
              <Text size="sm" ps="md">
                Top Level Attributes
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Box px="md">
                <DBRowJsonViewer
                  data={topLevelAttributes}
                  jsonColumns={jsonColumns}
                />
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        <Accordion.Item value="eventAttributes">
          <Accordion.Control>
            <Text size="sm" ps="md">
              {source.kind === 'log' ? 'Log' : 'Span'} Attributes
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Box px="md">
              <DBRowJsonViewer
                data={filteredEventAttributes}
                jsonColumns={jsonColumns}
              />
            </Box>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="resourceAttributes">
          <Accordion.Control>
            <Text size="sm" ps="md">
              Resource Attributes
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Flex wrap="wrap" gap="2px" mx="md" mb="lg">
              {Object.entries(resourceAttributes).map(([key, value]) => (
                <EventTag
                  {...(onPropertyAddClick
                    ? {
                        onPropertyAddClick,
                        sqlExpression:
                          source.resourceAttributesExpression &&
                          jsonColumns?.includes(
                            source.resourceAttributesExpression,
                          )
                            ? // If resource attributes is a JSON column, we need to cast the key to a string so we can run where X in Y queries
                              `toString(${source.resourceAttributesExpression}.${key})`
                            : `${source.resourceAttributesExpression}['${key}']`,
                      }
                    : {
                        onPropertyAddClick: undefined,
                        sqlExpression: undefined,
                      })}
                  generateSearchUrl={
                    generateSearchUrl ? _generateSearchUrl : undefined
                  }
                  displayedKey={key}
                  name={`${source.resourceAttributesExpression}.${key}`}
                  value={value as string}
                  key={key}
                />
              ))}
            </Flex>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}
