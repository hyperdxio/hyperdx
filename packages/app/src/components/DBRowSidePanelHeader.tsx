import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  Flex,
  Paper,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';

import EventTag from '@/components/EventTag';
import { FormatTime } from '@/useFormatTime';
import { useUserPreferences } from '@/useUserPreferences';
import { formatDistanceToNowStrictShort } from '@/utils';

import { RowSidePanelContext } from './DBRowSidePanel';
import LogLevel from './LogLevel';

const isValidDate = (date: Date) => 'getTime' in date && !isNaN(date.getTime());

const MAX_MAIN_CONTENT_LENGTH = 2000;

// Types for breadcrumb navigation
export type BreadcrumbEntry = {
  label: string;
  rowData?: Record<string, any>;
};

export type BreadcrumbPath = BreadcrumbEntry[];

function BreadcrumbNavigation({
  breadcrumbPath,
  onBreadcrumbClick,
}: {
  breadcrumbPath: BreadcrumbPath;
  onBreadcrumbClick?: () => void;
}) {
  // Function to extract clean body text for hover tooltip
  const getBodyTextForBreadcrumb = (rowData: Record<string, any>): string => {
    const bodyText = (rowData.__hdx_body || '').trim();

    return bodyText.length > 200
      ? `${bodyText.substring(0, 197)}...`
      : bodyText;
  };
  const breadcrumbItems = useMemo(() => {
    if (breadcrumbPath.length === 0) return [];

    const items = [];

    // Add all previous levels from breadcrumbPath
    breadcrumbPath.forEach((crumb, index) => {
      const tooltipText = crumb.rowData
        ? getBodyTextForBreadcrumb(crumb.rowData)
        : '';

      items.push(
        <Tooltip
          key={`crumb-${index}`}
          label={tooltipText}
          disabled={!tooltipText}
          position="bottom"
          withArrow
        >
          <UnstyledButton
            onClick={() => onBreadcrumbClick?.()}
            style={{ textDecoration: 'none' }}
          >
            <Text size="sm" c="blue.4" style={{ cursor: 'pointer' }}>
              {crumb.label}
            </Text>
          </UnstyledButton>
        </Tooltip>,
      );
    });

    // Add current level
    items.push(
      <Text key="current" size="sm" c="gray.2">
        Event Details
      </Text>,
    );

    return items;
  }, [breadcrumbPath, onBreadcrumbClick]);

  if (breadcrumbPath.length === 0) return null;

  return (
    <Box mb="sm" pb="sm" className="border-bottom border-dark">
      <Breadcrumbs separator="›" separatorMargin="xs">
        {breadcrumbItems}
      </Breadcrumbs>
    </Box>
  );
}

export default function DBRowSidePanelHeader({
  tags,
  mainContent = '',
  mainContentHeader,
  date,
  severityText,
  breadcrumbPath = [],
  onBreadcrumbClick,
}: {
  date: Date;
  mainContent?: string;
  mainContentHeader?: string;
  tags: Record<string, string>;
  severityText?: string;
  breadcrumbPath?: BreadcrumbPath;
  onBreadcrumbClick?: () => void;
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
      {/* Breadcrumb navigation */}
      <BreadcrumbNavigation
        breadcrumbPath={breadcrumbPath}
        onBreadcrumbClick={onBreadcrumbClick}
      />

      {/* Event timestamp and severity */}
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
            <Text size="xs" c="gray.4">
              {mainContentHeader}
            </Text>
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
