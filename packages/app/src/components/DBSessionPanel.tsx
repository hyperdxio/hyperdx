import { useMemo } from 'react';
import Link from 'next/link';
import { Loader } from '@mantine/core';

import useFieldExpressionGenerator from '@/hooks/useFieldExpressionGenerator';
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
  traceId?: string;
  dateRange: [Date, Date];
  enabled?: boolean;
}) => {
  // trace source
  const { data: source } = useSource({ id: sourceId });

  const { getFieldExpression } = useFieldExpressionGenerator(source);

  const config = useMemo(() => {
    if (!source || !traceId || !getFieldExpression) {
      return;
    }
    return {
      select: [
        {
          valueExpression: `${source.timestampValueExpression}`,
          alias: 'Timestamp',
        },
        {
          valueExpression: `${getFieldExpression(source.resourceAttributesExpression ?? 'ResourceAttributes', 'rum.sessionId')}`,
          alias: 'rumSessionId',
        },
        {
          valueExpression: `${getFieldExpression(source.resourceAttributesExpression ?? 'ResourceAttributes', 'service.name')}`,
          alias: 'serviceName',
        },
        {
          valueExpression: `${source.parentSpanIdExpression}`,
          alias: 'parentSpanId',
        },
      ],
      from: source.from,
      timestampValueExpression: source.timestampValueExpression,
      limit: { limit: 10000 },
      connection: source.connection,
      where: `${source.traceIdExpression} = '${traceId}'`,
      whereLanguage: 'sql' as const,
    };
  }, [source, traceId, getFieldExpression]);

  const { data } = useEventsData({
    config: config!, // ok to force unwrap, the query will be disabled if config is null
    dateRangeStartInclusive: true,
    dateRange,
    enabled: enabled && !!source && !!config,
  });

  const result = useMemo(() => {
    const rowData = data?.data || [];
    let row = rowData.find(
      row => row.parentSpanId === null && row.rumSessionId,
    );
    if (!row) {
      // otherwise just return the first session id
      row = rowData.find(row => row.rumSessionId);
    }
    if (row) {
      return {
        rumServiceName: row.serviceName,
        rumSessionId: row.rumSessionId,
      };
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
  const { data: traceSource } = useSource({ id: traceSourceId });
  const { data: sessionSource, isLoading: isSessionSourceLoading } = useSource({
    id: traceSource?.sessionSourceId,
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
