import { ErrorBoundary } from 'react-error-boundary';
import { Anchor, Button, Stack, Tooltip } from '@mantine/core';
import {
  IconArrowUpRight,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';

import { SectionWrapper, useShowMoreRows } from './ExceptionSubpanel';
import {
  LinkedSpanDetails,
  linkedSpanKey,
  LinkedSpanMetaLine,
} from './linkedSpans';
import { SpanLinkData } from './SpanLinksSubpanel';

function LinkedSpanRow({
  link,
  onOpenTrace,
}: {
  link: LinkedSpanDetails;
  onOpenTrace?: (link: SpanLinkData) => void;
}) {
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
          data-testid="linked-from-open-span"
          onClick={() =>
            onOpenTrace?.({
              TraceId: link.TraceId,
              SpanId: link.SpanId,
              TraceState: '',
              Attributes: {},
            })
          }
          size="sm"
          fw={500}
          className="d-inline-flex align-items-center"
        >
          <IconArrowUpRight size={14} className="me-1" />
          {link.spanName || 'Open span'}
        </Anchor>
      </Tooltip>
      <LinkedSpanMetaLine details={link} />
    </Stack>
  );
}

export const SpanLinkedFromSubpanel = ({
  links,
  onOpenTrace,
}: {
  links: LinkedSpanDetails[];
  onOpenTrace?: (link: SpanLinkData) => void;
}) => {
  const { handleToggleMoreRows, hiddenRowsCount, visibleRows, isExpanded } =
    useShowMoreRows({
      rows: links,
      maxRows: 5,
    });

  if (links.length === 0) {
    return null;
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
              An error occurred while rendering linked spans
            </div>
          )}
        >
          <Stack gap="sm" px="xs" py="xs">
            {visibleRows.map((link, index) => (
              <div
                key={linkedSpanKey(link.TraceId, link.SpanId)}
                data-testid="linked-from-row"
                className={
                  index > 0 ? 'pt-2 border-top border-dark' : undefined
                }
              >
                <LinkedSpanRow link={link} onOpenTrace={onOpenTrace} />
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
                <IconChevronUp size={14} className="me-2" /> Hide spans
              </>
            ) : (
              <>
                <IconChevronDown size={14} className="me-2" />
                Show {hiddenRowsCount} more spans
              </>
            )}
          </Button>
        ) : null}
      </SectionWrapper>
    </div>
  );
};
