import React, { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { ColumnDef } from '@tanstack/react-table';

import { FormatTime } from '@/useFormatTime';

import { DBRowJsonViewer } from './DBRowJsonViewer';
import { SectionWrapper, useShowMoreRows } from './ExceptionSubpanel';
import { Table } from './Table';

// Make sure SpanEventData implements Record<string, unknown>
interface SpanEventData extends Record<string, unknown> {
  Timestamp: string; // DateTime64(9)
  Name: string;
  Attributes: Record<string, string>;
}

const getSpanEventColumns = (labels: {
  timestamp: string;
  name: string;
  attributes: string;
  empty: string;
}): ColumnDef<SpanEventData>[] => [
  {
    accessorKey: 'Timestamp',
    header: labels.timestamp,
    size: 120,
    cell: ({ row }) => (
      <span className="text-muted" title={row.original.Timestamp}>
        <FormatTime
          value={new Date(row.original.Timestamp).getTime()}
          format="withMs"
        />
      </span>
    ),
  },
  {
    accessorKey: 'Name',
    header: labels.name,
    size: 180,
    cell: ({ row }) => (
      <span className="d-flex align-items-center gap-2">
        {row.original.Name}
      </span>
    ),
  },
  {
    accessorKey: 'Attributes',
    header: labels.attributes,
    size: 400,
    cell: ({ row }) => {
      const attributes = row.original.Attributes;
      if (attributes && Object.keys(attributes).length > 0) {
        return (
          <Box>
            <DBRowJsonViewer data={attributes} />
          </Box>
        );
      }
      return <span className="text-muted">{labels.empty}</span>;
    },
  },
];

export const SpanEventsSubpanel = ({
  spanEvents,
}: {
  spanEvents?: Record<string, unknown>[] | null;
}) => {
  const { t } = useTranslation('search');
  const spanEventColumns = useMemo(
    () =>
      getSpanEventColumns({
        timestamp: t('spanEvents.timestamp'),
        name: t('spanEvents.name'),
        attributes: t('spanEvents.attributes'),
        empty: t('spanEvents.empty'),
      }),
    [t],
  );
  const sortedEvents = useMemo(() => {
    if (!spanEvents || spanEvents.length === 0) {
      return [];
    }

    // Ensure events have the right shape with type checking
    const typedEvents = spanEvents.filter((event): event is SpanEventData => {
      return (
        typeof event.Timestamp === 'string' &&
        typeof event.Name === 'string' &&
        event.Attributes !== undefined
      );
    });

    // Sort events by timestamp
    return [...typedEvents].sort((a, b) => {
      const timeA = new Date(a.Timestamp).getTime();
      const timeB = new Date(b.Timestamp).getTime();
      return timeB - timeA; // Latest first
    });
  }, [spanEvents]);

  const { handleToggleMoreRows, hiddenRowsCount, visibleRows, isExpanded } =
    useShowMoreRows({
      rows: sortedEvents,
      maxRows: 5,
    });

  if (!sortedEvents || sortedEvents.length === 0) {
    return (
      <div className="p-3 text-muted fs-7">{t('spanEvents.unavailable')}</div>
    );
  }

  return (
    <div>
      <SectionWrapper>
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering span events
            </div>
          )}
        >
          <Table
            columns={spanEventColumns}
            data={visibleRows}
            emptyMessage={t('spanEvents.notFound')}
          />
        </ErrorBoundary>

        {hiddenRowsCount ? (
          <Button
            variant="secondary"
            size="xs"
            my="sm"
            onClick={handleToggleMoreRows}
          >
            {isExpanded ? (
              <>
                <IconChevronUp size={14} className="me-2" />
                {t('spanEvents.hide')}
              </>
            ) : (
              <>
                <IconChevronDown size={14} className="me-2" />
                {t('spanEvents.showMore', { count: hiddenRowsCount })}
              </>
            )}
          </Button>
        ) : null}
      </SectionWrapper>
    </div>
  );
};
