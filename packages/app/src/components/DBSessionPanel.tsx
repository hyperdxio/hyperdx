import { useMemo } from 'react';
import Link from 'next/link';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Loader } from '@mantine/core';

import SessionSubpanel from '@/SessionSubpanel';
import { useSource } from '@/source';

import { useEventsData } from './DBTraceWaterfallChart';

export const useSessionId = ({
  sourceId,
  traceId,
  dateRange,
  enabled = false,
}: {
  sourceId?: string;
  traceId: string;
  dateRange: [Date, Date];
  enabled?: boolean;
}) => {
  const { data: traceSource } = useSource({
    id: sourceId,
    kind: SourceKind.Trace,
  });

  const config = useMemo(() => {
    if (!traceSource) {
      return;
    }
    return {
      select: [
        {
          valueExpression: `${traceSource.timestampValueExpression}`,
          alias: 'Timestamp',
        },
        {
          valueExpression: `${traceSource.resourceAttributesExpression}['rum.sessionId']`,
          alias: 'rumSessionId',
        },
        {
          valueExpression: `${traceSource.resourceAttributesExpression}['service.name']`,
          alias: 'serviceName',
        },
        {
          valueExpression: `${traceSource.parentSpanIdExpression}`,
          alias: 'parentSpanId',
        },
      ],
      from: traceSource.from,
      timestampValueExpression: traceSource.timestampValueExpression,
      limit: { limit: 10000 },
      connection: traceSource.connection,
      where: `${traceSource.traceIdExpression} = '${traceId}'`,
      whereLanguage: 'sql' as const,
    };
  }, [traceSource, traceId]);

  const { data } = useEventsData({
    config: config!, // ok to force unwrap, the query will be disabled if source is null
    dateRangeStartInclusive: true,
    dateRange,
    enabled: enabled && !!traceSource,
  });

  const result = useMemo(() => {
    for (const row of data?.data || []) {
      if (row.parentSpanId === null && row.rumSessionId) {
        return {
          rumServiceName: row.serviceName,
          rumSessionId: row.rumSessionId,
        };
      }
    }
    // otherwise just return the first session id
    for (const row of data?.data || []) {
      if (row.rumSessionId) {
        return {
          rumServiceName: row.serviceName,
          rumSessionId: row.rumSessionId,
        };
      }
    }
    return { rumServiceName: undefined, rumSessionId: undefined };
  }, [data]);

  return result;
};

export const DBSessionPanel = ({
  traceSourceId,
  rumSessionId,
  dateRange,
  focusDate,
  serviceName,
  setSubDrawerOpen,
}: {
  traceSourceId?: string;
  rumSessionId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  serviceName: string;
  setSubDrawerOpen: (open: boolean) => void;
}) => {
  const { data: traceSource } = useSource({
    id: traceSourceId,
    kind: SourceKind.Trace,
  });
  const { data: sessionSource, isLoading: isSessionSourceLoading } = useSource({
    id: traceSource?.sessionSourceId,
    kind: SourceKind.Session,
  });

  if (!traceSource || (!sessionSource && isSessionSourceLoading)) {
    return <Loader />;
  }

  return (
    <>
      {!sessionSource ? (
        <div className="m-2 fs-8 p-4">
          No correlated session source found.
          <br />
          Go to <Link href="/team#sources">Team Settings</Link> and update the{' '}
          <strong>{traceSource?.name}</strong> source to include the correlated
          session source.
        </div>
      ) : rumSessionId && traceSource ? (
        <SessionSubpanel
          start={dateRange[0]}
          end={dateRange[1]}
          traceSource={traceSource}
          session={{ serviceName }}
          sessionSource={sessionSource}
          rumSessionId={rumSessionId}
          setDrawerOpen={setSubDrawerOpen}
          initialTs={focusDate.getTime()}
        />
      ) : (
        <span className="p-3 text-muted">Session ID not found.</span>
      )}
    </>
  );
};
