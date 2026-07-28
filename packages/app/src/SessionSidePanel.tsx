import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import { z } from 'zod';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
  TSessionSource,
  TTraceSource,
  WithClauseSchema,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Flex,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLink, IconX } from '@tabler/icons-react';

import {
  DBRowSidePanelInner,
  RowSidePanelContext,
  SidePanelErrorFallback,
} from '@/components/DBRowSidePanel';
import {
  DrawerFullWidthToggle,
  INITIAL_DRAWER_WIDTH_PERCENT,
} from '@/components/DrawerUtils';
import SidePanelBreadcrumbs, {
  BreadcrumbItem,
} from '@/components/SidePanelBreadcrumbs';
import { useCloseOnClickOutside } from '@/hooks/useCloseOnClickOutside';
import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';
import { parseAsJsonEncoded } from '@/utils/queryParsers';
import { buildShareUrl } from '@/utils/shareLink';
import { ZIndexContext } from '@/zIndex';

import useSidePanelStack from './hooks/useSidePanelStack';
import { Session } from './sessions';
import SessionSubpanel from './SessionSubpanel';
import { formatDistanceToNowStrictShort } from './utils';

import styles from '@/../styles/LogSidePanel.module.scss';

type SelectedEvent = {
  rowId: string;
  aliasWith: WithClause[];
  sessionId: string;
};

const sessionEventSchema = z.object({
  rowId: z.string(),
  aliasWith: z.array(WithClauseSchema),
  sessionId: z.string(),
});

const sessionEventParser = parseAsJsonEncoded<SelectedEvent>(
  sessionEventSchema.parse,
);

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
  closeOnClickOutside = true,
  keepOpenSelector,
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
  closeOnClickOutside?: boolean;
  keepOpenSelector?: string;
}) {
  // A single in-place event view (session → event), persisted to the URL so it
  // survives reload and shared links. Deeper navigation (View Trace,
  // surrounding context) is handled by `DBRowSidePanelInner`, which persists
  // its own state to the shared `sidePanel*` params below.
  const [persistedEvent, setSelectedEvent] = useQueryState(
    'sessionPanelEvent',
    sessionEventParser,
  );

  // Read-time ownership gate: a persisted event belongs to the session it was
  // opened in. If the user clicks a different session card (which updates the
  // session params without going through this drawer's handlers), the old event
  // is simply not selected — it can never render inside the wrong session,
  // regardless of remount timing. No evict effect required.
  const selectedEvent =
    persistedEvent != null && persistedEvent.sessionId === sessionId
      ? persistedEvent
      : null;

  const { size, setSize, startResize } = useResizable(
    INITIAL_DRAWER_WIDTH_PERCENT,
  );
  const isFullWidth = size >= 99;
  const toggleFullWidth = useCallback(() => {
    setSize(isFullWidth ? INITIAL_DRAWER_WIDTH_PERCENT : 100);
  }, [isFullWidth, setSize]);

  const sessionLabel = session?.userEmail || `Anonymous Session ${sessionId}`;

  const sidePanelStack = useSidePanelStack({
    initialRowId: selectedEvent?.rowId,
  });

  const handleBackToSession = useCallback(() => {
    setSelectedEvent(null);
    sidePanelStack.clearTrail();
  }, [setSelectedEvent, sidePanelStack]);

  const handleEventNavigate = useCallback(
    (rowId: string, aliasWith: WithClause[]) => {
      sidePanelStack.clearTrail();
      setSelectedEvent({ rowId, aliasWith, sessionId });
    },
    [setSelectedEvent, sidePanelStack, sessionId],
  );

  // X / Esc-at-root closes the whole panel and clears the session-panel params.
  const handleClose = useCallback(() => {
    setSelectedEvent(null);
    sidePanelStack.clearTrail();
    onClose();
  }, [setSelectedEvent, sidePanelStack, onClose]);

  useHotkeys(['esc'], handleClose, { enabled: !selectedEvent });

  // Match the Esc behavior: dismiss on outside click only at the session root,
  // so deep in-panel navigation (event → trace → context) isn't skipped.
  useCloseOnClickOutside({
    enabled: closeOnClickOutside && sessionId != null && !selectedEvent,
    keepOpenSelector,
    onClose: handleClose,
  });

  const shareSession = useCallback(async () => {
    const url = await buildShareUrl(window.location.search);
    const ok = await copyTextToClipboard(url);
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
      <ZIndexContext value={zIndex}>
        <div
          className={styles.panel}
          data-testid="session-side-panel"
          style={{ position: 'relative' }}
        >
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          {selectedEvent ? (
            <RowSidePanelContext
              value={{ isChildModalOpen: false, source: traceSource }}
            >
              <ErrorBoundary
                fallbackRender={fallbackProps => (
                  <SidePanelErrorFallback
                    {...fallbackProps}
                    onClose={handleClose}
                  />
                )}
              >
                <DBRowSidePanelInner
                  source={traceSource}
                  rowId={selectedEvent.rowId}
                  aliasWith={selectedEvent.aliasWith}
                  sidePanelStack={sidePanelStack}
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
            </RowSidePanelContext>
          ) : (
            <>
              <Box px="sm" pt="sm" pb="xs">
                <Flex align="center" justify="space-between" gap="sm" mb={8}>
                  <SidePanelBreadcrumbs
                    items={breadcrumbs}
                    onBack={handleClose}
                  />
                  <Group gap="xs" align="center" wrap="nowrap">
                    <Button
                      variant="secondary"
                      size="compact-sm"
                      leftSection={<IconLink size={14} />}
                      style={{ fontSize: '12px' }}
                      onClick={shareSession}
                      data-testid="session-share-button"
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
      </ZIndexContext>
    </Drawer>
  );
}
