import React, { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Box, Button, Text } from '@mantine/core';
import { ColumnDef } from '@tanstack/react-table';

import { FormatTime } from '@/useFormatTime';

import { DBRowJsonViewer } from './DBRowJsonViewer';
import { SectionWrapper, useShowMoreRows } from './ExceptionSubpanel';
import { Table } from './Table';

interface SpanEventData {
  Timestamp: string; // DateTime64(9)
  Name: string;
  Attributes: Record<string, string>;
}

const spanEventColumns: ColumnDef<SpanEventData>[] = [
  {
    accessorKey: 'Timestamp',
    header: 'Timestamp',
    size: 120,
    cell: ({ row }) => (
      <span className="text-slate-500">
        <FormatTime
          value={new Date(row.original.Timestamp).getTime()}
          format="withMs"
        />
      </span>
    ),
  },
  {
    accessorKey: 'Name',
    header: 'Name',
    size: 180,
    cell: ({ row }) => (
      <span className="text-slate-300 d-flex align-items-center gap-2">
        {row.original.Name}
      </span>
    ),
  },
  {
    accessorKey: 'Attributes',
    header: 'Attributes',
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
      return <span className="text-slate-500">Empty</span>;
    },
  },
];

export const SpanEventsSubpanel = ({
  spanEvents,
}: {
  spanEvents?: SpanEventData[] | null;
}) => {
  const sortedEvents = useMemo(() => {
    if (!spanEvents || spanEvents.length === 0) {
      return [];
    }
    // Sort events by timestamp
    return [...spanEvents].sort((a, b) => {
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
      <div className="p-3 text-slate-500 fs-7">
        No span events available for this trace
      </div>
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
            emptyMessage="No span events found"
          />
        </ErrorBoundary>

        {hiddenRowsCount ? (
          <Button
            variant="default"
            size="xs"
            my="sm"
            c="gray.4"
            onClick={handleToggleMoreRows}
          >
            {isExpanded ? (
              <>
                <i className="bi bi-chevron-up me-2" /> Hide events
              </>
            ) : (
              <>
                <i className="bi bi-chevron-down me-2" />
                Show {hiddenRowsCount} more events
              </>
            )}
          </Button>
        ) : null}
      </SectionWrapper>
    </div>
  );
};
