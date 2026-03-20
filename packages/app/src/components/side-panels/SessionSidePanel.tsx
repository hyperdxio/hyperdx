import { useCallback, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  CopyButton,
  Drawer,
  Flex,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconShare,
  IconX,
} from '@tabler/icons-react';

import useResizable from '@/hooks/useResizable';
import { Session } from '@/sessions';
import { formatDistanceToNowStrictShort } from '@/utils';
import { ZIndexContext } from '@/zIndex';

import { getInitialDrawerWidthPercent } from './DrawerUtils';
import SessionContentPanel from './SessionContentPanel';

import styles from '@/../styles/LogSidePanel.module.scss';

export default function SessionSidePanel({
  traceSource,
  sessionSource,
  sessionId,
  session,
  dateRange,
  where,
  whereLanguage,
  onLanguageChange,
  onClose,
  onPropertyAddClick,
  generateSearchUrl,
  generateChartUrl,
  zIndex = 100,
}: {
  traceSource: TSource;
  sessionSource: TSource;
  sessionId: string;
  session: Session;
  dateRange: DateRange['dateRange'];
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  onLanguageChange?: (lang: 'sql' | 'lucene') => void;
  onClose: () => void;
  onPropertyAddClick?: (name: string, value: string) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
  zIndex?: number;
}) {
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  const initialWidth = getInitialDrawerWidthPercent();
  const { size, setSize, startResize } = useResizable(initialWidth);

  const isFullWidth = size >= 99;
  const toggleFullWidth = useCallback(() => {
    setSize(isFullWidth ? getInitialDrawerWidthPercent() : 100);
  }, [isFullWidth, setSize]);

  useHotkeys(
    ['esc'],
    () => {
      onClose();
    },
    {
      enabled: subDrawerOpen === false,
    },
  );

  const maxTime =
    session != null ? new Date(session?.maxTimestamp) : new Date();
  const timeAgo = formatDistanceToNowStrictShort(maxTime);

  return (
    <Drawer
      opened={sessionId != null}
      onClose={() => {
        if (!subDrawerOpen) {
          onClose();
        }
      }}
      position="right"
      size={`${size}vw`}
      withCloseButton={false}
      zIndex={zIndex}
      styles={{
        body: {
          padding: 0,
          height: '100vh',
        },
      }}
    >
      <ZIndexContext.Provider value={zIndex}>
        <div className={styles.panel}>
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          <Flex
            align="center"
            justify="space-between"
            gap="sm"
            px="sm"
            py="xs"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
              <Tooltip label="Back" position="bottom">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={onClose}
                  aria-label="Back"
                >
                  <IconArrowLeft size={16} />
                </ActionIcon>
              </Tooltip>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate="end">
                  {session?.userEmail || `Anonymous Session ${sessionId}`}
                </Text>
                <Group gap={4}>
                  <Text size="xs" c="dimmed">
                    Last active {timeAgo} ago
                  </Text>
                  {Number.parseInt(session?.errorCount ?? '0') > 0 && (
                    <>
                      <Text size="xs" c="dimmed">
                        ·
                      </Text>
                      <Text size="xs" c="red">
                        {session?.errorCount} Errors
                      </Text>
                    </>
                  )}
                  <Text size="xs" c="dimmed">
                    ·
                  </Text>
                  <Text size="xs" c="dimmed">
                    {session?.sessionCount} Events
                  </Text>
                </Group>
              </div>
            </Group>
            <Group gap={8} wrap="nowrap">
              <CopyButton
                value={
                  typeof window !== 'undefined' ? window.location.href : ''
                }
              >
                {({ copied, copy }) => (
                  <Tooltip
                    label={copied ? 'Copied!' : 'Share link'}
                    position="bottom"
                  >
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={copy}
                      aria-label="Share"
                    >
                      <IconShare size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
              <Tooltip
                label={isFullWidth ? 'Exit full width' : 'Full width'}
                position="bottom"
              >
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={toggleFullWidth}
                  aria-label={isFullWidth ? 'Exit full width' : 'Full width'}
                >
                  {isFullWidth ? (
                    <IconArrowsMinimize size={16} />
                  ) : (
                    <IconArrowsMaximize size={16} />
                  )}
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Close" position="bottom">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Flex>
          {sessionId != null ? (
            <SessionContentPanel
              traceSource={traceSource}
              sessionSource={sessionSource}
              session={session}
              start={dateRange[0]}
              end={dateRange[1]}
              rumSessionId={sessionId}
              onPropertyAddClick={onPropertyAddClick}
              generateSearchUrl={generateSearchUrl}
              generateChartUrl={generateChartUrl}
              setDrawerOpen={setSubDrawerOpen}
              where={where}
              whereLanguage={whereLanguage}
              onLanguageChange={onLanguageChange}
            />
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
