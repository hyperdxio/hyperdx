import { Button } from 'react-bootstrap';
import CopyToClipboard from 'react-copy-to-clipboard';
import { useHotkeys } from 'react-hotkeys-hook';
import Drawer from 'react-modern-drawer';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { useRowSidePanel } from '@/hooks/useRowSidePanel';

import { Session } from './sessions';
import SessionSubpanel from './SessionSubpanel';
import { formatDistanceToNowStrictShort } from './utils';
import { useZIndex, ZIndexContext } from './zIndex';

import 'react-modern-drawer/dist/index.css';

export default function SessionSidePanel({
  traceSource,
  sessionSource,
  sessionId,
  session,
  dateRange,
  where,
  whereLanguage,
  onClose,
  onPropertyAddClick,
  generateSearchUrl,
  generateChartUrl,
}: {
  traceSource: TSource;
  sessionSource: TSource;
  sessionId: string;
  session: Session;
  dateRange: DateRange['dateRange'];
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  onClose: () => void;
  onPropertyAddClick?: (name: string, value: string) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
}) {
  const { sidePanel } = useRowSidePanel();
  const subDrawerOpen = !!sidePanel;

  const contextZIndex = useZIndex();
  const zIndex = contextZIndex + 1;

  useHotkeys(
    ['esc'],
    () => {
      onClose();
    },
    { enabled: !subDrawerOpen },
  );

  const maxTime =
    session != null ? new Date(session?.maxTimestamp) : new Date();

  const timeAgo = formatDistanceToNowStrictShort(maxTime);

  return (
    <Drawer
      customIdSuffix={`session-side-panel-${sessionId}`}
      duration={0}
      overlayOpacity={0.5}
      open={sessionId != null}
      onClose={() => {
        if (!subDrawerOpen) {
          onClose();
        }
      }}
      direction="right"
      size={'82vw'}
      style={{ background: '#0F1216' }}
      className="border-start border-dark"
      zIndex={zIndex}
    >
      <ZIndexContext.Provider value={zIndex}>
        <div className="d-flex flex-column h-100">
          <div>
            <div className="p-3 d-flex align-items-center justify-content-between border-bottom border-dark">
              <div style={{ width: '50%', maxWidth: 500 }}>
                {session?.userEmail || `Anonymous Session ${sessionId}`}
                <div className="text-muted fs-8 mt-1">
                  <span>Last active {timeAgo} ago</span>
                  <span className="mx-2">·</span>
                  {Number.parseInt(session?.errorCount ?? '0') > 0 ? (
                    <>
                      <span className="text-danger fs-8">
                        {session?.errorCount} Errors
                      </span>
                      <span className="mx-2">·</span>
                    </>
                  ) : null}
                  <span>{session?.sessionCount} Events</span>
                </div>
              </div>
              <div className="d-flex">
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
                    variant="dark"
                    className="text-muted-hover mx-2 d-flex align-items-center fs-8"
                    size="sm"
                  >
                    <i className="bi bi-link-45deg me-2 fs-7.5" />
                    Share Session
                  </Button>
                </CopyToClipboard>
                <Button
                  variant="dark"
                  className="text-muted-hover d-flex align-items-center"
                  size="sm"
                  onClick={onClose}
                >
                  <i className="bi bi-x-lg" />
                </Button>
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
              onPropertyAddClick={onPropertyAddClick}
              generateSearchUrl={generateSearchUrl}
              generateChartUrl={generateChartUrl}
              where={where}
              whereLanguage={whereLanguage}
            />
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
