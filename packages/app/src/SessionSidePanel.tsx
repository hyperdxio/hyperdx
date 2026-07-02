import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLink, IconX } from '@tabler/icons-react';

import {
  DBRowSidePanelInner,
  RowSidePanelContext,
} from '@/components/DBRowSidePanel';
import {
  DrawerFullWidthToggle,
  INITIAL_DRAWER_WIDTH_PERCENT,
} from '@/components/DrawerUtils';
import SidePanelBreadcrumbs, {
  BreadcrumbItem,
} from '@/components/SidePanelBreadcrumbs';
import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';
import { parseAsJsonEncoded } from '@/utils/queryParsers';
import { ZIndexContext } from '@/zIndex';

import { Session } from './sessions';
import SessionSubpanel from './SessionSubpanel';
import { formatDistanceToNowStrictShort } from './utils';

import styles from '@/../styles/LogSidePanel.module.scss';

type SelectedEvent = {
  rowId: string;
  aliasWith: WithClause[];
};

export default function SessionSidePanel({
  traceSource,
  sessionSource,
  sessionId,
  session,
  dateRange,
  whereLanguage,
  onLanguageChange,
  onClose,
  zIndex = 100,
}: {
  traceSource: TTraceSource;
  sessionSource: TSessionSource;
  sessionId: string;
  session: Session;
  dateRange: DateRange['dateRange'];
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  onLanguageChange?: (lang: 'sql' | 'lucene') => void;
  onClose: () => void;
  zIndex?: number;
}) {
  // A single in-place event view (session → event), persisted to the URL so it
  // survives reload and shared links. Deeper navigation (View Trace,
  // surrounding context) is handled by `DBRowSidePanelInner`, which persists
  // its own state to the shared `sidePanel*` params below.
  const [selectedEvent, setSelectedEvent] = useQueryState(
    'sessionPanelEvent',
    parseAsJsonEncoded<SelectedEvent>(),
  );

  // The embedded `DBRowSidePanelInner` owns these shared params. We clear them
  // whenever the session-level selection changes so a stale inner stack can't
  // leak across events or sessions.
  const [, setSourceStackParam] = useQueryState('sidePanelSourceStack');
  const [, setNavStackParam] = useQueryState('sidePanelNavStack');
  const [, setSidePanelTab] = useQueryState('sidePanelTab');

  const { size, setSize, startResize } = useResizable(
    INITIAL_DRAWER_WIDTH_PERCENT,
  );
  const isFullWidth = size >= 99;
  const toggleFullWidth = useCallback(() => {
    setSize(isFullWidth ? INITIAL_DRAWER_WIDTH_PERCENT : 100);
  }, [isFullWidth, setSize]);

  const sessionLabel = session?.userEmail || `Anonymous Session ${sessionId}`;

  const clearInnerNavigation = useCallback(() => {
    setSourceStackParam(null);
    setNavStackParam(null);
    setSidePanelTab(null);
  }, [setSourceStackParam, setNavStackParam, setSidePanelTab]);

  const handleBackToSession = useCallback(() => {
    setSelectedEvent(null);
    clearInnerNavigation();
  }, [setSelectedEvent, clearInnerNavigation]);

  const handleEventNavigate = useCallback(
    (rowId: string, aliasWith: WithClause[]) => {
      clearInnerNavigation();
      setSelectedEvent({ rowId, aliasWith });
    },
    [setSelectedEvent, clearInnerNavigation],
  );

  // X / Esc-at-root closes the whole panel and clears the session-panel params.
  const handleClose = useCallback(() => {
    setSelectedEvent(null);
    clearInnerNavigation();
    onClose();
  }, [setSelectedEvent, clearInnerNavigation, onClose]);

  // Back pops to the session root; X always closes the whole panel.
  const handleNavigateBack = useCallback(() => {
    if (selectedEvent) {
      handleBackToSession();
    } else {
      handleClose();
    }
  }, [selectedEvent, handleBackToSession, handleClose]);

  useHotkeys(['esc'], handleNavigateBack);

  const shareSession = useCallback(async () => {
    const ok = await copyTextToClipboard(window.location.href);
    notifications.show(
      ok
        ? { color: 'green', message: 'Copied link to clipboard' }
        : { color: 'red', message: CLIPBOARD_ERROR_MESSAGE },
    );
  }, []);

  const breadcrumbs = useMemo(
    (): BreadcrumbItem[] => [
      { label: sessionLabel, sourceKind: SourceKind.Session },
    ],
    [sessionLabel],
  );

  const timeAgo = useMemo(() => {
    const maxTime =
      // eslint-disable-next-line no-restricted-syntax
      session != null ? new Date(session?.maxTimestamp) : new Date();
    return formatDistanceToNowStrictShort(maxTime);
  }, [session]);

  return (
    <Drawer
      opened={sessionId != null}
      onClose={handleClose}
      position="right"
      size={`${size}vw`}
      withCloseButton={false}
      closeOnEscape={false}
      lockScroll={false}
      withOverlay={false}
      trapFocus={false}
      zIndex={zIndex}
      styles={{
        content: {
          border: 'none',
          boxShadow: 'var(--shadow-drawer)',
        },
        body: {
          padding: 0,
          height: '100%',
        },
      }}
    >
      <ZIndexContext.Provider value={zIndex}>
        <div
          className={styles.panel}
          data-testid="session-side-panel"
          style={{ position: 'relative' }}
        >
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          {selectedEvent ? (
            <RowSidePanelContext.Provider
              value={{ isChildModalOpen: false, source: traceSource }}
            >
              <ErrorBoundary
                fallbackRender={error => (
                  <Stack>
                    <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
                      An error occurred while rendering this event.
                    </div>
                    <div className="px-2 py-1 m-2 fs-7 font-monospace bg-body p-4">
                      {error?.error?.message}
                    </div>
                  </Stack>
                )}
              >
                <DBRowSidePanelInner
                  source={traceSource}
                  rowId={selectedEvent.rowId}
                  aliasWith={selectedEvent.aliasWith}
                  onClose={handleClose}
                  onNavigateToParent={handleBackToSession}
                  isFullWidth={isFullWidth}
                  onToggleFullWidth={toggleFullWidth}
                  parentBreadcrumbs={[
                    {
                      label: sessionLabel,
                      sourceKind: SourceKind.Session,
                      onClick: handleBackToSession,
                    },
                  ]}
                />
              </ErrorBoundary>
            </RowSidePanelContext.Provider>
          ) : (
            <>
              <Box px="sm" pt="sm" pb="xs">
                <Flex align="center" justify="space-between" gap="sm" mb={8}>
                  <SidePanelBreadcrumbs
                    items={breadcrumbs}
                    onBack={handleNavigateBack}
                  />
                  <Group gap="xs" align="center" wrap="nowrap">
                    <Button
                      variant="secondary"
                      size="compact-sm"
                      leftSection={<IconLink size={14} />}
                      style={{ fontSize: '12px' }}
                      onClick={shareSession}
                    >
                      Share Session
                    </Button>
                    <DrawerFullWidthToggle
                      isFullWidth={isFullWidth}
                      onToggle={toggleFullWidth}
                    />
                    <Tooltip label="Close" position="bottom">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={handleClose}
                        aria-label="Close"
                      >
                        <IconX size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Flex>
                <Text size="xs" c="dimmed">
                  Last active {timeAgo} ago
                  {Number.parseInt(session?.errorCount ?? '0') > 0 && (
                    <>
                      {' · '}
                      <Text component="span" size="xs" c="red">
                        {session?.errorCount} Errors
                      </Text>
                    </>
                  )}
                  {' · '}
                  {session?.sessionCount} Events
                </Text>
              </Box>
              <div className="d-flex flex-column overflow-hidden flex-grow-1">
                <SessionSubpanel
                  traceSource={traceSource}
                  sessionSource={sessionSource}
                  session={session}
                  start={dateRange[0]}
                  end={dateRange[1]}
                  rumSessionId={sessionId}
                  onEventNavigate={handleEventNavigate}
                  whereLanguage={whereLanguage}
                  onLanguageChange={onLanguageChange}
                />
              </div>
            </>
          )}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
