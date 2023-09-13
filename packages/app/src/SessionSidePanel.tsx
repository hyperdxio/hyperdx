import CopyToClipboard from 'react-copy-to-clipboard';
import Drawer from 'react-modern-drawer';
import { Button } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { useHotkeys } from 'react-hotkeys-hook';
import { useState } from 'react';

import api from './api';
import SessionSubpanel from './SessionSubpanel';
import { formatDistanceToNowStrictShort } from './utils';

import 'react-modern-drawer/dist/index.css';
import { ZIndexContext } from './zIndex';

export default function SessionSidePanel({
  sessionId,
  dateRange,
  onClose,
  onPropertyAddClick,
  generateSearchUrl,
  generateChartUrl,
  zIndex = 100,
}: {
  sessionId: string;
  dateRange: [Date, Date];
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
  useHotkeys(['esc'], () => {
    onClose();
  });

  // TODO: DRY with sessions page?
  const { data: tableData } = api.useSessions({
    startDate: dateRange[0],
    endDate: dateRange[1],
    q: `rum_session_id: "${sessionId}"`,
  });

  const session = tableData?.data[0];

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

  const maxTime =
    session != null ? new Date(session?.maxTimestamp) : new Date();
  const timeAgo = formatDistanceToNowStrictShort(maxTime);

  return (
    <Drawer
      customIdSuffix={`session-side-panel-${sessionId}`}
      duration={0}
      overlayOpacity={0.2}
      open={sessionId != null}
      onClose={() => {
        if (!subDrawerOpen) {
          onClose();
        }
      }}
      direction="right"
      size={'85vw'}
      style={{ background: '#0F1216' }}
      className="border-start border-dark"
      zIndex={zIndex}
    >
      <ZIndexContext.Provider value={zIndex}>
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
            <div>
              <CopyToClipboard
                text={window.location.href}
                onCopy={() => {
                  toast.success('Copied link to clipboard');
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
            </div>
          </div>
        </div>
        <div className="p-3 h-100 d-flex flex-column fs-8">
          {sessionId != null ? (
            <div className="mt-3 overflow-hidden">
              <SessionSubpanel
                start={dateRange[0]}
                end={dateRange[1]}
                rumSessionId={sessionId}
                onPropertyAddClick={onPropertyAddClick}
                generateSearchUrl={generateSearchUrl}
                generateChartUrl={generateChartUrl}
                setDrawerOpen={setSubDrawerOpen}
              />
            </div>
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
