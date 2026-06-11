import React, { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Box, Button } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { ColumnDef } from '@tanstack/react-table';

import { DBRowJsonViewer } from './DBRowJsonViewer';
import { SectionWrapper, useShowMoreRows } from './ExceptionSubpanel';
import { Table } from './Table';

// Make sure SpanLinkData implements Record<string, unknown>
interface SpanLinkData extends Record<string, unknown> {
  TraceId: string;
  SpanId: string;
  TraceState: string;
  Attributes: Record<string, string>;
}

const spanLinkColumns: ColumnDef<SpanLinkData>[] = [
  {
    accessorKey: 'TraceId',
    header: 'Trace ID',
    size: 280,
    cell: ({ row }) => (
      <span className="font-monospace text-break">{row.original.TraceId}</span>
    ),
  },
  {
    accessorKey: 'SpanId',
    header: 'Span ID',
    size: 160,
    cell: ({ row }) => (
      <span className="font-monospace text-break">{row.original.SpanId}</span>
    ),
  },
  {
    accessorKey: 'TraceState',
    header: 'Trace State',
    size: 120,
    cell: ({ row }) =>
      row.original.TraceState ? (
        <span className="text-break">{row.original.TraceState}</span>
      ) : (
        <span className="text-muted">Empty</span>
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
      return <span className="text-muted">Empty</span>;
    },
  },
];

export const SpanLinksSubpanel = ({
  spanLinks,
}: {
  spanLinks?: Record<string, unknown>[] | null;
}) => {
  const links = useMemo(() => {
    if (!spanLinks || spanLinks.length === 0) {
      return [];
    }

    // Ensure links have the right shape with type checking. Span links carry
    // no timestamp, so they keep the order ClickHouse returns them in (the
    // order they appear in the span's Links column).
    return spanLinks.filter((link): link is SpanLinkData => {
      return (
        typeof link.TraceId === 'string' &&
        typeof link.SpanId === 'string' &&
        link.Attributes !== undefined
      );
    });
  }, [spanLinks]);

  const { handleToggleMoreRows, hiddenRowsCount, visibleRows, isExpanded } =
    useShowMoreRows({
      rows: links,
      maxRows: 5,
    });

  if (!links || links.length === 0) {
    return (
      <div className="p-3 text-muted fs-7">
        No span links available for this trace
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
              An error occurred while rendering span links
            </div>
          )}
        >
          <Table
            columns={spanLinkColumns}
            data={visibleRows}
            emptyMessage="No span links found"
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
                <IconChevronUp size={14} className="me-2" /> Hide links
              </>
            ) : (
              <>
                <IconChevronDown size={14} className="me-2" />
                Show {hiddenRowsCount} more links
              </>
            )}
          </Button>
        ) : null}
      </SectionWrapper>
    </div>
  );
};
