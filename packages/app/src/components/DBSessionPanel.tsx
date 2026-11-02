import { useMemo } from 'react';
import Link from 'next/link';
import { isTraceSource, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Loader } from '@mantine/core';

import useFieldExpressionGenerator from '@/hooks/useFieldExpressionGenerator';
import SessionSubpanel from '@/SessionSubpanel';
import { useSource } from '@/source';
import { SessionIdKey, traceSessionIdColumns } from '@/utils/sessionId';
import type { SessionEventNavigate } from '@/utils/sessionLogEvents';

import { useEventsData } from './DBTraceWaterfallChart';

type SessionIdRow = {
  rumSessionId?: string;
  otelSessionId?: string;
  serviceName?: string;
};

/**
 * A legacy SDK id anywhere in the trace wins over `session.id` rows, so a trace
 * that carries one always opens the legacy replay.
 */
export function pickSessionIdRow(rows: SessionIdRow[]): {
  rumSessionId?: string;
  rumServiceName?: string;
  sessionIdKey?: SessionIdKey;
} {
  const rumRow = rows.find(row => row.rumSessionId);
  if (rumRow) {
    return {
      rumSessionId: rumRow.rumSessionId,
      rumServiceName: rumRow.serviceName,
      sessionIdKey: 'rum.sessionId',
    };
  }

  const otelRow = rows.find(row => row.otelSessionId);
  if (otelRow) {
    return {
      rumSessionId: otelRow.otelSessionId,
      rumServiceName: otelRow.serviceName,
      sessionIdKey: 'session.id',
    };
  }
  return {};
}

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
  const { data: source } = useSource({
    id: sourceId,
    kinds: [SourceKind.Trace],
  });

  const { getFieldExpression } = useFieldExpressionGenerator(source);

  const config = useMemo(() => {
    if (!source || !traceId || !getFieldExpression) {
      return;
    }
    const { attrs } = traceSessionIdColumns(source);
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
          // Only browser SDK spans carry the page URL; other `session.id`
          // spans (AI agent conversations, backends) have no replay.
          valueExpression: `if(${getFieldExpression(attrs, 'browser.document.url.full')} != '', ${getFieldExpression(attrs, 'session.id')}, '')`,
          alias: 'otelSessionId',
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

  return useMemo(() => pickSessionIdRow(data?.data ?? []), [data]);
};

export const DBSessionPanel = ({
  traceSourceId,
  rumSessionId,
  sessionIdKey,
  dateRange,
  focusDate,
  serviceName,
  onEventNavigate,
}: {
  traceSourceId?: string;
  rumSessionId?: string;
  sessionIdKey?: SessionIdKey;
  dateRange: [Date, Date];
  focusDate: Date;
  serviceName?: string;
  onEventNavigate?: SessionEventNavigate;
}) => {
  const { data: traceSource } = useSource({
    id: traceSourceId,
    kinds: [SourceKind.Trace],
  });
  const { data: sessionSource, isLoading: isSessionSourceLoading } = useSource({
    id:
      traceSource && isTraceSource(traceSource)
        ? traceSource.sessionSourceId
        : undefined,
    kinds: [SourceKind.Session],
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
          session={{ serviceName: serviceName ?? '', sessionIdKey }}
          sessionSource={sessionSource}
          rumSessionId={rumSessionId}
          onEventNavigate={onEventNavigate}
          initialTs={focusDate.getTime()}
        />
      ) : (
        <span className="p-3 text-muted">Session ID not found.</span>
      )}
    </>
  );
};
