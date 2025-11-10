import { useState } from 'react';
import CopyToClipboard from 'react-copy-to-clipboard';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Button } from '@mantine/core';
import { Drawer } from '@mantine/core';
import { notifications } from '@mantine/notifications';

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
  where,
  whereLanguage,
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

  // console.log({ logId: sessionId, subDrawerOpen });
  const maxTime =
    session != null ? new Date(session?.maxTimestamp) : new Date();
  // const minTime =
  //   session != null ? new Date(session?.['min_timestamp']) : new Date();
  const timeAgo = formatDistanceToNowStrictShort(maxTime);
  // const durationStr = new Date(maxTime.getTime() - minTime.getTime())
  //   .toISOString()
  //   .slice(11, 19);

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
          background: '#0F1216',
          height: '100vh',
        },
      }}
      className="border-start border-dark"
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
                    variant="default"
                    size="sm"
                    leftSection={<i className="bi bi-link-45deg fs-7.5" />}
                    style={{ fontSize: '12px' }}
                  >
                    Share Session
                  </Button>
                </CopyToClipboard>
                <Button
                  variant="default"
                  size="sm"
                  onClick={onClose}
                  style={{ padding: '4px 8px' }}
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
              setDrawerOpen={setSubDrawerOpen}
              where={where}
              whereLanguage={whereLanguage}
            />
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
