import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { isTraceSource, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Loader } from '@mantine/core';

import useFieldExpressionGenerator from '@/hooks/useFieldExpressionGenerator';
import { WithClause } from '@/hooks/useRowWhere';
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
  const { data: source } = useSource({
    id: sourceId,
    kinds: [SourceKind.Trace],
  });

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
  onEventNavigate,
}: {
  traceSourceId?: string;
  rumSessionId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  serviceName: string;
  onEventNavigate?: (rowId: string, aliasWith: WithClause[]) => void;
}) => {
  const { t } = useTranslation('sessions');
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
          {t('correlation.notFound')}
          <br />
          {t('correlation.goTo')}{' '}
          <Link href="/team#sources">{t('correlation.teamSettings')}</Link>{' '}
          {t('correlation.updatePrefix')} <strong>{traceSource?.name}</strong>{' '}
          {t('correlation.updateSuffix')}
        </div>
      ) : rumSessionId && traceSource ? (
        <SessionSubpanel
          start={dateRange[0]}
          end={dateRange[1]}
          traceSource={traceSource}
          session={{ serviceName }}
          sessionSource={sessionSource}
          rumSessionId={rumSessionId}
          onEventNavigate={onEventNavigate}
          initialTs={focusDate.getTime()}
        />
      ) : (
        <span className="p-3 text-muted">{t('correlation.idNotFound')}</span>
      )}
    </>
  );
};
