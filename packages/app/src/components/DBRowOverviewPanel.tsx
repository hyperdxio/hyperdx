import { useCallback, useContext, useMemo } from 'react';
import { isString, pickBy } from 'lodash';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Accordion, Box, Divider, Flex, Text } from '@mantine/core';

import { getEventBody } from '@/source';

import { useRowData } from './DBRowDataPanel';
import { DBRowJsonViewer } from './DBRowJsonViewer';
import { RowSidePanelContext } from './DBRowSidePanel';
import DBRowSidePanelHeader from './DBRowSidePanelHeader';
import EventTag from './EventTag';
import { ExceptionSubpanel, parseEvents } from './ExceptionSubpanel';
import { NetworkPropertySubpanel } from './NetworkPropertyPanel';

const EMPTY_OBJ = {};
export function RowOverviewPanel({
  source,
  rowId,
  hideHeader = false,
}: {
  source: TSource;
  rowId: string | undefined | null;
  hideHeader?: boolean;
}) {
  const { data, isLoading, isError } = useRowData({ source, rowId });
  const { onPropertyAddClick, generateSearchUrl } =
    useContext(RowSidePanelContext);

  const eventAttributesExpr = source.eventAttributesExpression;

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  const resourceAttributes = firstRow?.__hdx_resource_attributes ?? EMPTY_OBJ;
  const eventAttributes = firstRow?.__hdx_event_attributes ?? EMPTY_OBJ;
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

  const mainContentColumn = getEventBody(source);
  const mainContent = isString(firstRow?.['__hdx_body'])
    ? firstRow['__hdx_body']
    : firstRow?.['__hdx_body'] !== undefined
      ? JSON.stringify(firstRow['__hdx_body'])
      : undefined;

  return (
    <div className="flex-grow-1 bg-body overflow-auto">
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
          'network',
          'resourceAttributes',
          'eventAttributes',
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
                  eventAttributes={eventAttributes}
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

        <Accordion.Item value="eventAttributes">
          <Accordion.Control>
            <Text size="sm" c="gray.2" ps="md">
              {source.kind === 'log' ? 'Log' : 'Span'} Attributes
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Box px="md">
              <DBRowJsonViewer data={filteredEventAttributes} />
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
                  onPropertyAddClick={onPropertyAddClick!}
                  generateSearchUrl={_generateSearchUrl}
                  displayedKey={key}
                  // TODO: Escape properly
                  sqlExpression={`${source.resourceAttributesExpression}['${key}']`}
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
