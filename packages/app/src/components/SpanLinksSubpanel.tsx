import React, { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Anchor, Button, Flex, Stack, Tooltip } from '@mantine/core';
import {
  IconArrowUpRight,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';

import EventTag from './EventTag';
import { SectionWrapper, useShowMoreRows } from './ExceptionSubpanel';

// Make sure SpanLinkData implements Record<string, unknown>
export interface SpanLinkData extends Record<string, unknown> {
  TraceId: string;
  SpanId: string;
  TraceState: string;
  Attributes: Record<string, string>;
}

// A raw `Links` element is a usable span link only when it has the string
// TraceId + SpanId the "Open trace" action needs and an Attributes object.
export function getValidSpanLinks(
  spanLinks?: Record<string, unknown>[] | null,
): SpanLinkData[] {
  if (!Array.isArray(spanLinks) || spanLinks.length === 0) {
    return [];
  }
  return spanLinks.filter((link): link is SpanLinkData => {
    return (
      typeof link.TraceId === 'string' &&
      typeof link.SpanId === 'string' &&
      link.Attributes !== undefined
    );
  });
}

function SpanLinkRow({
  link,
  onOpenTrace,
}: {
  link: SpanLinkData;
  onOpenTrace?: (link: SpanLinkData) => void;
}) {
  const attributeEntries = Object.entries(link.Attributes ?? {});
  const hasTraceState =
    typeof link.TraceState === 'string' && link.TraceState.length > 0;
  const hasChips = hasTraceState || attributeEntries.length > 0;

  return (
    <Stack gap={4}>
      <Tooltip
        withArrow
        position="top"
        maw={420}
        multiline
        label={
          <div className="font-monospace" style={{ fontSize: 11 }}>
            <div style={{ wordBreak: 'break-all' }}>Trace: {link.TraceId}</div>
            <div style={{ wordBreak: 'break-all' }}>Span: {link.SpanId}</div>
          </div>
        }
      >
        <Anchor
          component="button"
          type="button"
          data-testid="span-link-open-trace"
          onClick={() => onOpenTrace?.(link)}
          size="sm"
          fw={500}
          className="d-inline-flex align-items-center"
        >
          <IconArrowUpRight size={14} className="me-1" />
          Open trace
        </Anchor>
      </Tooltip>

      {hasChips ? (
        <Flex wrap="wrap" gap="2px" align="baseline">
          {hasTraceState ? (
            <EventTag
              displayedKey="trace state"
              name="trace state"
              value={link.TraceState}
              sqlExpression={undefined}
              onPropertyAddClick={undefined}
            />
          ) : null}
          {attributeEntries.map(([key, value]) => (
            <EventTag
              key={key}
              displayedKey={key}
              name={key}
              value={String(value)}
              sqlExpression={undefined}
              onPropertyAddClick={undefined}
            />
          ))}
        </Flex>
      ) : null}
    </Stack>
  );
}

export const SpanLinksSubpanel = ({
  spanLinks,
  onOpenTrace,
}: {
  spanLinks?: Record<string, unknown>[] | null;
  onOpenTrace?: (link: SpanLinkData) => void;
}) => {
  const links = useMemo(() => getValidSpanLinks(spanLinks), [spanLinks]);

  const { handleToggleMoreRows, hiddenRowsCount, visibleRows, isExpanded } =
    useShowMoreRows({
      rows: links,
      maxRows: 5,
    });

  if (links.length === 0) {
    return (
      <div className="p-3 text-muted fs-7" data-testid="span-links-empty">
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
          <Stack gap="sm" px="xs" py="xs">
            {visibleRows.map((link, index) => (
              <div
                // eslint-disable-next-line @eslint-react/no-array-index-key
                key={`${link.TraceId}-${link.SpanId}-${index}`}
                data-testid="span-link-row"
                className={
                  index > 0 ? 'pt-2 border-top border-dark' : undefined
                }
              >
                <SpanLinkRow link={link} onOpenTrace={onOpenTrace} />
              </div>
            ))}
          </Stack>
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
