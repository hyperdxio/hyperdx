import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Box, Button, Flex, Modal, Paper, Popover, Text } from '@mantine/core';

import EventTag from '@/components/EventTag';
import { TableSourceForm } from '@/components/SourceForm';
import { FormatTime } from '@/useFormatTime';
import { useUserPreferences } from '@/useUserPreferences';
import { formatDistanceToNowStrictShort } from '@/utils';

import { RowSidePanelContext } from './DBRowSidePanel';
import LogLevel from './LogLevel';

const isValidDate = (date: Date) => 'getTime' in date && !isNaN(date.getTime());

const MAX_MAIN_CONTENT_LENGTH = 2000;

const EditButton = ({
  sourceId,
  label,
}: {
  sourceId: string;
  label?: string;
}) => {
  return (
    <Popover width={600} position="bottom" withArrow withinPortal={false}>
      <Popover.Target>
        <Button size="compact-xs" variant="subtle" color="gray">
          <i className="bi bi-gear-fill fs-8.5" />
          {label && <span className="ms-2">{label}</span>}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <TableSourceForm sourceId={sourceId} />
      </Popover.Dropdown>
    </Popover>
  );
};

export default function DBRowSidePanelHeader({
  sourceId,
  tags,
  mainContent = '',
  mainContentHeader,
  date,
  severityText,
}: {
  sourceId: string;
  date: Date;
  mainContent?: string;
  mainContentHeader?: string;
  tags: Record<string, string>;
  severityText?: string;
}) {
  const [bodyExpanded, setBodyExpanded] = React.useState(false);
  const { onPropertyAddClick, generateSearchUrl } =
    useContext(RowSidePanelContext);

  const isContentTruncated = mainContent.length > MAX_MAIN_CONTENT_LENGTH;
  const mainContentDisplayed = React.useMemo(
    () =>
      bodyExpanded
        ? mainContent
        : mainContent?.slice(0, MAX_MAIN_CONTENT_LENGTH),
    [bodyExpanded, mainContent],
  );

  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    if (!headerRef.current) return;
    const el = headerRef.current;

    const updateHeight = () => {
      const newHeight = el.offsetHeight;
      setHeaderHeight(newHeight);
    };
    updateHeight();

    // Set up a resize observer to detect height changes
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(el);

    // Clean up the observer on component unmount
    return () => {
      resizeObserver.disconnect();
    };
  }, [headerRef.current, setHeaderHeight]);

  const { userPreferences, setUserPreference } = useUserPreferences();
  const { expandSidebarHeader } = userPreferences;
  const maxBoxHeight = 120;

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

  return (
    <>
      <Flex>
        {severityText && <LogLevel level={severityText} />}
        {severityText && isValidDate(date) && (
          <Text size="xs" mx="xs" c="gray.4">
            &middot;
          </Text>
        )}
        {isValidDate(date) && (
          <Text c="gray.4" size="xs">
            <FormatTime value={date} /> &middot;{' '}
            {formatDistanceToNowStrictShort(date)} ago
          </Text>
        )}
      </Flex>
      {mainContent ? (
        <Paper
          bg="dark.7"
          p="xs"
          mt="sm"
          style={{
            maxHeight: expandSidebarHeader ? undefined : maxBoxHeight,
            overflow: 'auto',
            overflowWrap: 'break-word',
          }}
          ref={headerRef}
        >
          <Flex justify="space-between" mb="xs">
            <Flex align="baseline" gap={2}>
              <Text size="xs" c="gray.4">
                {mainContentHeader}
              </Text>
              <EditButton sourceId={sourceId} />
            </Flex>
            {/* Toggles expanded sidebar header*/}
            {headerHeight >= maxBoxHeight && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray.3"
                onClick={() =>
                  setUserPreference({
                    ...userPreferences,
                    expandSidebarHeader: !expandSidebarHeader,
                  })
                }
              >
                {/* TODO: Only show expand button when maxHeight = 120? */}
                {expandSidebarHeader ? (
                  <i className="bi bi-arrows-angle-contract" />
                ) : (
                  <i className="bi bi-arrows-angle-expand" />
                )}
              </Button>
            )}
          </Flex>
          {mainContentDisplayed}
          {isContentTruncated && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => {
                setBodyExpanded(prev => !prev);
              }}
            >
              {bodyExpanded ? 'Collapse' : 'Expand'}
            </Button>
          )}
        </Paper>
      ) : (
        <Paper bg="dark.7" p="xs" mt="sm">
          <Text size="xs" c="gray.4" mb="xs">
            [Empty]
          </Text>
          <EditButton sourceId={sourceId} label="Set body expression" />
        </Paper>
      )}
      <Flex mt="sm">
        {Object.entries(tags).map(([sqlKey, value]) => {
          // Convert SQL syntax to Lucene syntax
          // SQL: column['property.foo'] -> Lucene: column.property.foo
          // or SQL: column -> Lucene: column
          const luceneKey = sqlKey.replace(/\['([^']+)'\]/g, '.$1');

          return onPropertyAddClick ? (
            <EventTag
              onPropertyAddClick={onPropertyAddClick}
              sqlExpression={sqlKey} // Original SQL syntax for property add
              generateSearchUrl={_generateSearchUrl}
              displayedKey={luceneKey} // Show friendly Lucene format
              name={luceneKey} // Use Lucene syntax for search
              value={value}
              key={sqlKey}
            />
          ) : (
            <EventTag
              onPropertyAddClick={undefined}
              sqlExpression={undefined}
              generateSearchUrl={_generateSearchUrl}
              displayedKey={luceneKey}
              name={luceneKey}
              value={value}
              key={sqlKey}
            />
          );
        })}
      </Flex>
    </>
  );
}
