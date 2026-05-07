import { useMemo, useState } from 'react';
import { Trans } from 'next-i18next/pages';
import CopyToClipboard from 'react-copy-to-clipboard';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Button, Drawer } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLink, IconX } from '@tabler/icons-react';

import { Session } from './sessions';
import SessionSubpanel from './SessionSubpanel';
import { formatDistanceToNowStrictShort } from './utils';
import { ZIndexContext } from './zIndex';

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
  // Keep track of sub-drawers so we can disable closing this root drawer
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  useHotkeys(
    ['esc'],
    () => {
      onClose();
    },
    {
      enabled: subDrawerOpen === false,
    },
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
      onClose={() => {
        if (!subDrawerOpen) {
          onClose();
        }
      }}
      position="right"
      size="82vw"
      withCloseButton={false}
      zIndex={zIndex}
      styles={{
        body: {
          padding: 0,
          height: '100vh',
        },
      }}
      className="border-start"
    >
      <ZIndexContext.Provider value={zIndex}>
        <div
          className="d-flex flex-column h-100"
          data-testid="session-side-panel"
        >
          <div>
            <div className="p-3 d-flex align-items-center justify-content-between border-bottom border-dark">
              <div style={{ width: '50%', maxWidth: 500 }}>
                {session?.userEmail || `Anonymous Session ${sessionId}`}
                <div className="text-muted fs-8 mt-1">
                  <span>
                    <Trans>Last active</Trans> {timeAgo} <Trans>ago</Trans>
                  </span>
                  <span className="mx-2">·</span>
                  {Number.parseInt(session?.errorCount ?? '0') > 0 ? (
                    <>
                      <span className="text-danger fs-8">
                        {session?.errorCount} <Trans>Errors</Trans>
                      </span>
                      <span className="mx-2">·</span>
                    </>
                  ) : null}
                  <span>
                    {session?.sessionCount} <Trans>Events</Trans>
                  </span>
                </div>
              </div>
              <div className="d-flex gap-2">
                <CopyToClipboard
                  text={window.location.href}
                  onCopy={() => {
                    notifications.show({
                      color: 'green',
                      message: 'Copied link to clipboard',
                    });
                  }}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    leftSection={<IconLink size={14} />}
                    style={{ fontSize: '12px' }}
                  >
                    <Trans>Share Session</Trans>
                  </Button>
                </CopyToClipboard>
                <ActionIcon variant="secondary" size="md" onClick={onClose}>
                  <IconX size={14} />
                </ActionIcon>
              </div>
            </div>
          </div>
          {sessionId != null ? (
            <SessionSubpanel
              traceSource={traceSource}
              sessionSource={sessionSource}
              session={session}
              start={dateRange[0]}
              end={dateRange[1]}
              rumSessionId={sessionId}
              setDrawerOpen={setSubDrawerOpen}
              whereLanguage={whereLanguage}
              onLanguageChange={onLanguageChange}
            />
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
