import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Flex, Paper, Text } from '@mantine/core';
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
} from '@tabler/icons-react';

import { useUserPreferences } from '@/useUserPreferences';

import AISummarizeButton from './AISummarizeButton';
import {
  DBHighlightedAttributesList,
  HighlightedAttribute,
} from './DBHighlightedAttributesList';

const MAX_MAIN_CONTENT_LENGTH = 2000;

export default function DBRowSidePanelHeader({
  attributes,
  mainContent = '',
  mainContentHeader,
  // When `true`, the source has a body column configured. An empty value
  // for that column renders a soft empty-state paper. When `false` (the
  // source has neither body nor implicit column configured), the body
  // paper is suppressed entirely; the highlighted attributes still render.
  bodyConfigured = true,
  severityText,
  rowData,
}: {
  mainContent?: string;
  mainContentHeader?: string;
  bodyConfigured?: boolean;
  attributes?: HighlightedAttribute[];
  severityText?: string;
  rowData?: Record<string, any>;
}) {
  const [bodyExpanded, setBodyExpanded] = React.useState(false);

  const isContentTruncated = mainContent.length > MAX_MAIN_CONTENT_LENGTH;
  const mainContentDisplayed = React.useMemo(
    () =>
      bodyExpanded
        ? mainContent
        : mainContent?.slice(0, MAX_MAIN_CONTENT_LENGTH),
    [bodyExpanded, mainContent],
  );

  const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    if (!headerElement) return;

    const updateHeight = () => {
      const newHeight = headerElement.offsetHeight;
      setHeaderHeight(newHeight);
    };
    updateHeight();

    // Set up a resize observer to detect height changes
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(headerElement);

    // Clean up the observer on component unmount
    return () => {
      resizeObserver.disconnect();
    };
  }, [headerElement]);

  const { userPreferences, setUserPreference } = useUserPreferences();
  const { expandSidebarHeader } = userPreferences;
  const maxBoxHeight = 120;

  const attributesWithDefault = useMemo(() => {
    return attributes ?? [];
  }, [attributes]);

  const toggleExpandSidebarHeader = useCallback(() => {
    setUserPreference({
      ...userPreferences,
      expandSidebarHeader: !expandSidebarHeader,
    });
  }, [expandSidebarHeader, setUserPreference, userPreferences]);

  return (
    <>
      {!bodyConfigured ? null : mainContent ? (
        <Paper
          p="xs"
          mt="sm"
          style={{
            maxHeight: expandSidebarHeader ? undefined : maxBoxHeight,
            overflow: 'auto',
            overflowWrap: 'break-word',
          }}
          ref={setHeaderElement}
        >
          <Flex justify="space-between" mb="xs">
            <Text size="xs">{mainContentHeader}</Text>
            {/* Toggles expanded sidebar header*/}
            {headerHeight >= maxBoxHeight && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={toggleExpandSidebarHeader}
              >
                {expandSidebarHeader ? (
                  <IconArrowsDiagonalMinimize2 size={14} />
                ) : (
                  <IconArrowsDiagonal size={14} />
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
        <Paper p="xs" mt="sm">
          <Text size="xs" c="dimmed">
            No body for this event.
          </Text>
        </Paper>
      )}
      <AISummarizeButton rowData={rowData} severityText={severityText} />
      <Box mt="xs">
        <DBHighlightedAttributesList attributes={attributesWithDefault} />
      </Box>
    </>
  );
}
