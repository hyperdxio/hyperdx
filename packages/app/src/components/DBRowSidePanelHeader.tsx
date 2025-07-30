import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Flex,
  Group,
  Paper,
  Stack,
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
  previewData?: {
    title?: string;
    subtitle?: string;
    details?: Array<{ label: string; value: string }>;
    timestamp?: Date;
    eventCount?: number;
  };
};

export type BreadcrumbPath = BreadcrumbEntry[];

// Navigation callback type - called when user wants to navigate to a specific level
export type BreadcrumbNavigationCallback = (targetLevel: number) => void;

function getBodyTextForBreadcrumb(rowData: Record<string, any>): string {
  const bodyText = (rowData.__hdx_body || '').trim();
  const BREADCRUMB_TOOLTIP_MAX_LENGTH = 200;
  const BREADCRUMB_TOOLTIP_TRUNCATED_LENGTH = 197;

  return bodyText.length > BREADCRUMB_TOOLTIP_MAX_LENGTH
    ? `${bodyText.substring(0, BREADCRUMB_TOOLTIP_TRUNCATED_LENGTH)}...`
    : bodyText;
}

function PreviewTooltip({
  children,
  previewData,
  fallbackText,
  rowData,
}: {
  children: React.ReactNode;
  previewData?: BreadcrumbEntry['previewData'];
  fallbackText?: string;
  rowData?: Record<string, any>;
}) {
  // If no preview data, fall back to simple text tooltip
  if (!previewData && !fallbackText) {
    return <>{children}</>;
  }

  if (!previewData) {
    return (
      <Tooltip
        label={fallbackText}
        disabled={!fallbackText}
        position="bottom"
        withArrow
      >
        {children}
      </Tooltip>
    );
  }

  // Get the log content from rowData
  const logContent = rowData ? getBodyTextForBreadcrumb(rowData) : '';

  const tooltipContent = (
    <Stack gap="xs" maw={320}>
      {previewData.title && (
        <Text size="sm" fw={500} c="white">
          {previewData.title}
        </Text>
      )}
      {previewData.subtitle && (
        <Text size="xs" c="gray.3">
          {previewData.subtitle}
        </Text>
      )}
      {previewData.timestamp && (
        <Group gap="xs">
          <Text size="xs" c="gray.4">
            <FormatTime value={previewData.timestamp} />
          </Text>
          <Text size="xs" c="gray.4">
            •
          </Text>
          <Text size="xs" c="gray.4">
            {formatDistanceToNowStrictShort(previewData.timestamp)} ago
          </Text>
        </Group>
      )}
      {previewData.eventCount && (
        <Badge size="sm" variant="light" color="blue">
          {previewData.eventCount} events
        </Badge>
      )}

      {/* Show the actual log content */}
      {logContent && (
        <Paper
          p="xs"
          bg="dark.9"
          style={{
            borderRadius: '4px',
            border: '1px solid var(--mantine-color-dark-6)',
          }}
        >
          <Text size="xs" c="gray.4" mb="xs" fw={500}>
            Log Content:
          </Text>
          <Text
            size="xs"
            c="gray.1"
            style={{
              fontFamily: 'monospace',
              lineHeight: 1.4,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            {logContent}
          </Text>
        </Paper>
      )}

      {previewData.details && previewData.details.length > 0 && (
        <Stack gap="xs" mt="xs">
          {previewData.details.slice(0, 3).map((detail, index) => (
            <Group key={index} justify="space-between" gap="xs">
              <Text size="xs" c="gray.4" style={{ minWidth: 0, flex: 1 }}>
                {detail.label}:
              </Text>
              <Text
                size="xs"
                c="gray.2"
                style={{
                  minWidth: 0,
                  flex: 2,
                  textAlign: 'right',
                  wordBreak: 'break-word',
                }}
              >
                {detail.value}
              </Text>
            </Group>
          ))}
          {previewData.details.length > 3 && (
            <Text size="xs" c="gray.5" style={{ textAlign: 'center' }}>
              +{previewData.details.length - 3} more
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );

  return (
    <Tooltip
      label={tooltipContent}
      position="bottom"
      withArrow
      multiline
      w={320}
      openDelay={500}
      styles={{
        tooltip: {
          backgroundColor: 'var(--mantine-color-dark-8)',
          border: '1px solid var(--mantine-color-dark-6)',
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        },
      }}
    >
      {children}
    </Tooltip>
  );
}

function BreadcrumbNavigation({
  breadcrumbPath,
  onNavigateToLevel,
}: {
  breadcrumbPath: BreadcrumbPath;
  onNavigateToLevel?: BreadcrumbNavigationCallback;
}) {
  const handleBreadcrumbItemClick = useCallback(
    (clickedIndex: number) => {
      // Navigate to the clicked breadcrumb level
      // This will close all panels above this level
      onNavigateToLevel?.(clickedIndex);
    },
    [onNavigateToLevel],
  );

  const breadcrumbItems = useMemo(() => {
    if (breadcrumbPath.length === 0) return [];

    const items = [];

    // Add all previous levels from breadcrumbPath
    breadcrumbPath.forEach((crumb, index) => {
      const fallbackText = crumb.rowData
        ? getBodyTextForBreadcrumb(crumb.rowData)
        : '';

      items.push(
        <PreviewTooltip
          key={`crumb-${index}`}
          previewData={crumb.previewData}
          fallbackText={fallbackText}
          rowData={crumb.rowData}
        >
          <UnstyledButton
            onClick={() => handleBreadcrumbItemClick(index)}
            style={{ textDecoration: 'none' }}
          >
            <Text size="sm" c="blue.4" style={{ cursor: 'pointer' }}>
              {index === 0 ? 'Original Event' : crumb.label}
            </Text>
          </UnstyledButton>
        </PreviewTooltip>,
      );
    });

    // Add current level
    items.push(
      <Text key="current" size="sm" c="gray.2">
        Selected Event
      </Text>,
    );

    return items;
  }, [breadcrumbPath, handleBreadcrumbItemClick]);

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
  onBreadcrumbClick?: BreadcrumbNavigationCallback;
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
        onNavigateToLevel={onBreadcrumbClick}
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
