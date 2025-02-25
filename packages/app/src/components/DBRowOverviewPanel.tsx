import { useCallback, useContext, useMemo } from 'react';
import { pickBy } from 'lodash';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Accordion, Box, Divider, Flex, Text } from '@mantine/core';

import { useRowData } from './DBRowDataPanel';
import { DBRowJsonViewer } from './DBRowJsonViewer';
import { RowSidePanelContext } from './DBRowSidePanel';
import EventTag from './EventTag';
import { NetworkPropertySubpanel } from './NetworkPropertyPanel';

export function RowOverviewPanel({
  source,
  rowId,
}: {
  source: TSource;
  rowId: string | undefined | null;
}) {
  const { data, isLoading, isError } = useRowData({ source, rowId });
  const { onPropertyAddClick, generateSearchUrl } =
    useContext(RowSidePanelContext);

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  const resourceAttributes = firstRow?.__hdx_resource_attributes;
  const eventAttributes = firstRow?.__hdx_event_attributes;

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
    return eventAttributes?.['http.url'] != null;
  }, [eventAttributes]);

  const filteredEventAttributes = useMemo(() => {
    if (isHttpRequest) {
      return pickBy(eventAttributes, (value, key) => {
        return !key.startsWith('http.');
      });
    }
    return eventAttributes;
  }, [eventAttributes, isHttpRequest]);

  return (
    <div className="flex-grow-1 bg-body overflow-auto">
      <Accordion
        mt="sm"
        defaultValue={['network', 'resourceAttributes', 'eventAttributes']}
        multiple
      >
        {eventAttributes && (
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
        <Divider my="md" />
        <Box px="md">
          <Text size="sm" c="gray.2">
            Resource Attributes
          </Text>
        </Box>
        <Flex mt="md" wrap="wrap" gap="2px" mx="md" mb="lg">
          {Object.entries(resourceAttributes).map(([key, value]) => (
            <EventTag
              onPropertyAddClick={onPropertyAddClick}
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
      </Accordion>
    </div>
  );
}
