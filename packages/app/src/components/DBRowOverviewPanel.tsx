import { useCallback, useContext, useMemo } from 'react';
import { flatten } from 'flat';
import isString from 'lodash/isString';
import pickBy from 'lodash/pickBy';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Accordion, Box, Divider, Flex, Text } from '@mantine/core';

import { getEventBody } from '@/source';

import { getJSONColumnNames, useRowData } from './DBRowDataPanel';
import { DBRowJsonViewer } from './DBRowJsonViewer';
import { RowSidePanelContext } from './DBRowSidePanel';
import DBRowSidePanelHeader from './DBRowSidePanelHeader';
import EventTag from './EventTag';
import { ExceptionSubpanel, parseEvents } from './ExceptionSubpanel';
import { NetworkPropertySubpanel } from './NetworkPropertyPanel';
import { SpanEventsSubpanel } from './SpanEventsSubpanel';

const EMPTY_OBJ = {};
export function RowOverviewPanel({
  source,
  rowId,
  hideHeader = false,
  'data-testid': dataTestId,
}: {
  source: TSource;
  rowId: string | undefined | null;
  hideHeader?: boolean;
  'data-testid'?: string;
}) {
  const { data, isLoading, isError } = useRowData({ source, rowId });
  const { onPropertyAddClick, generateSearchUrl } =
    useContext(RowSidePanelContext);

  const jsonColumns = getJSONColumnNames(data?.meta);

  const eventAttributesExpr = source.eventAttributesExpression;

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

  // memo
  const resourceAttributes = useMemo(() => {
    return flatten<string, Record<string, string>>(
      firstRow?.__hdx_resource_attributes ?? EMPTY_OBJ,
    );
  }, [firstRow?.__hdx_resource_attributes]);

  const _eventAttributes = firstRow?.__hdx_event_attributes ?? EMPTY_OBJ;
  const flattenedEventAttributes = useMemo(() => {
    return flatten<string, Record<string, string>>(_eventAttributes);
  }, [_eventAttributes]);

  const dataAttributes =
    eventAttributesExpr &&
    firstRow?.[eventAttributesExpr] &&
    Object.keys(firstRow[eventAttributesExpr]).length > 0
      ? { [eventAttributesExpr]: firstRow[eventAttributesExpr] }
      : {};

  const _generateSearchUrl = useCallback(
    (query?: string, timeRange?: [Date, Date]) => {
      return (
        generateSearchUrl?.({
          where: query,
          whereLanguage: 'lucene',
        }) ?? '/'
      );
    },
    [generateSearchUrl],
  );

  const isHttpRequest = useMemo(() => {
    const attributes =
      eventAttributesExpr && dataAttributes?.[eventAttributesExpr];
    return attributes?.['http.url'] != null;
  }, [dataAttributes, eventAttributesExpr]);

  const filteredEventAttributes = useMemo(() => {
    if (!eventAttributesExpr) return dataAttributes;

    const attributes = dataAttributes?.[eventAttributesExpr];
    return isHttpRequest && attributes
      ? {
          [eventAttributesExpr]: pickBy(
            attributes,
            (_, key) => !key.startsWith('http.'),
          ),
        }
      : dataAttributes;
  }, [dataAttributes, isHttpRequest, eventAttributesExpr]);

  const exceptionValues = useMemo(() => {
    const parsedEvents =
      firstRow?.__hdx_events_exception_attributes ?? EMPTY_OBJ;
    const stacktrace =
      parsedEvents?.['exception.stacktrace'] ||
      parsedEvents?.['exception.parsed_stacktrace'];

    let parsedStacktrace = stacktrace ?? '[]';
    try {
      parsedStacktrace = JSON.parse(stacktrace);
    } catch (e) {
      // do nothing
    }

    return [
      {
        stacktrace: parsedStacktrace,
        type: parsedEvents?.['exception.type'],
        value:
          typeof parsedEvents?.['exception.message'] !== 'string'
            ? JSON.stringify(parsedEvents?.['exception.message'])
            : parsedEvents?.['exception.message'],
        mechanism: parsedEvents?.['exception.mechanism'],
      },
    ];
  }, [firstRow]);

  const hasException = useMemo(() => {
    return (
      Object.keys(firstRow?.__hdx_events_exception_attributes ?? {}).length > 0
    );
  }, [firstRow?.__hdx_events_exception_attributes]);

  const hasSpanEvents = useMemo(() => {
    return (
      Array.isArray(firstRow?.__hdx_span_events) &&
      firstRow?.__hdx_span_events.length > 0
    );
  }, [firstRow?.__hdx_span_events]);

  const mainContentColumn = getEventBody(source);
  const mainContent = isString(firstRow?.['__hdx_body'])
    ? firstRow['__hdx_body']
    : firstRow?.['__hdx_body'] !== undefined
      ? JSON.stringify(firstRow['__hdx_body'])
      : undefined;

  return (
    <div className="flex-grow-1 bg-body overflow-auto" data-testid={dataTestId}>
      {!hideHeader && (
        <Box px="32px" pt="md">
          <DBRowSidePanelHeader
            date={new Date(firstRow?.__hdx_timestamp ?? 0)}
            tags={{}}
            mainContent={mainContent}
            mainContentHeader={mainContentColumn}
            severityText={firstRow?.__hdx_severity_text}
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
      >
        {isHttpRequest && (
          <Accordion.Item value="network">
            <Accordion.Control>
              <Text size="sm" c="gray.2" ps="md">
                HTTP Request
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Box px="md">
                <NetworkPropertySubpanel
                  eventAttributes={flattenedEventAttributes}
                  onPropertyAddClick={onPropertyAddClick}
                  generateSearchUrl={_generateSearchUrl}
                />
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {hasException && (
          <Accordion.Item value="exception">
            <Accordion.Control>
              <Text size="sm" c="gray.2" ps="md">
                Exception
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Box px="md">
                <ExceptionSubpanel
                  exceptionValues={exceptionValues}
                  breadcrumbs={[]}
                  logData={{
                    timestamp: firstRow?.__hdx_timestamp,
                  }}
                />
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {hasSpanEvents && (
          <Accordion.Item value="spanEvents">
            <Accordion.Control>
              <Text size="sm" c="gray.2" ps="md">
                Span Events
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Box px="md">
                <SpanEventsSubpanel spanEvents={firstRow?.__hdx_span_events} />
              </Box>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {Object.keys(topLevelAttributes).length > 0 && (
          <Accordion.Item value="topLevelAttributes">
            <Accordion.Control>
              <Text size="sm" c="gray.2" ps="md">
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
            <Text size="sm" c="gray.2" ps="md">
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
            <Text size="sm" c="gray.2" ps="md">
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
                        sqlExpression: `${source.resourceAttributesExpression}['${key}']`,
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
