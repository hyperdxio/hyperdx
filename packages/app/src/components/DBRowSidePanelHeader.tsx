import React from 'react';
import { Box, Button, Flex, Modal, Paper, Popover, Text } from '@mantine/core';

import EventTag from '@/components/EventTag';
import { TableSourceForm } from '@/components/SourceForm';
import { FormatTime } from '@/useFormatTime';
import { formatDistanceToNowStrictShort } from '@/utils';

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
  tags: { [key: string]: string };
  severityText?: string;
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
            maxHeight: 120,
            overflow: 'auto',
            overflowWrap: 'break-word',
          }}
        >
          <Flex align="baseline" gap={2} mb="xs">
            <Text size="xs" c="gray.4">
              {mainContentHeader}
            </Text>
            <EditButton sourceId={sourceId} />
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
      {/* <EventTag
        generateSearchUrl={() => ''}
        displayedKey="hi"
        name="hi"
        value="hi"
      /> */}
    </>
  );
}
