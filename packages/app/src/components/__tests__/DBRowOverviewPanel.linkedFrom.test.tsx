import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: (args: unknown) => mockUseRowData(args),
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

jest.mock('../DBRowSidePanel', () => {
  const { createContext } = jest.requireActual('react');
  return {
    __esModule: true,
    RowSidePanelContext: createContext({}),
  };
});

jest.mock('../DBRowJsonViewer', () => ({
  __esModule: true,
  DBRowJsonViewer: () => null,
}));
jest.mock('../DBRowSidePanelHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../EventTag', () => ({ __esModule: true, default: () => null }));
jest.mock('../ExceptionSubpanel', () => ({
  __esModule: true,
  ExceptionSubpanel: () => null,
}));
jest.mock('../NetworkPropertyPanel', () => ({
  __esModule: true,
  NetworkPropertySubpanel: () => null,
}));
jest.mock('../SpanEventsSubpanel', () => ({
  __esModule: true,
  SpanEventsSubpanel: () => null,
}));
const mockSpanLinksSubpanel = jest.fn();
jest.mock('../SpanLinksSubpanel', () => ({
  __esModule: true,
  getValidSpanLinks: jest.requireActual('../SpanLinksSubpanel')
    .getValidSpanLinks,
  SpanLinksSubpanel: (props: unknown) => {
    mockSpanLinksSubpanel(props);
    return null;
  },
}));

const mockUseReverseSpanLinks = jest.fn();
const mockUseLinkedSpanDetails = jest.fn();
jest.mock('../linkedSpans', () => ({
  __esModule: true,
  useReverseSpanLinks: (args: unknown) => mockUseReverseSpanLinks(args),
  useLinkedSpanDetails: (args: unknown) => mockUseLinkedSpanDetails(args),
  linkedSpanKey: (traceId: string, spanId: string) => `${traceId}:${spanId}`,
  LinkedSpanMetaLine: () => null,
}));
jest.mock('../SpanLinkedFromSubpanel', () => ({
  __esModule: true,
  SpanLinkedFromSubpanel: () => <div data-testid="linked-from-subpanel" />,
}));

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => undefined,
}));
jest.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: () => [],
}));

const ANCHOR = new Date('2024-01-02T12:00:00.000Z');
jest.mock('@/utils/rowTimestamps', () => ({
  __esModule: true,
  resolveRowTimestampAnchor: () => new Date('2024-01-02T12:00:00.000Z'),
}));

import { RowOverviewPanel } from '@/components/DBRowOverviewPanel';

const TRACE_SOURCE: TSource = {
  id: 'trace-src',
  name: 'Traces',
  kind: SourceKind.Trace,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, SpanName',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  durationExpression: 'Duration',
  durationPrecision: 9,
  spanLinksValueExpression: 'Links',
};

const ROW = {
  __hdx_trace_id: 'trace-1',
  __hdx_span_id: 'span-1',
};

const LINK = {
  TraceId: 'other-trace',
  SpanId: 'other-span',
  spanName: 'consume message',
};

describe('RowOverviewPanel linked-from section', () => {
  beforeEach(() => {
    mockUseRowData.mockReset();
    mockUseReverseSpanLinks.mockReset();
    mockUseLinkedSpanDetails.mockReset();
    mockUseLinkedSpanDetails.mockReturnValue({ details: new Map() });
    mockUseRowData.mockReturnValue({ data: { data: [ROW], meta: [] } });
  });

  it('shows the section when reverse links exist', () => {
    mockUseReverseSpanLinks.mockReturnValue({ links: [LINK] });

    renderWithMantine(
      <RowOverviewPanel source={TRACE_SOURCE} rowId="SpanId='span-1'" />,
    );

    expect(screen.getByText('Linked from')).toBeInTheDocument();
    expect(screen.getByTestId('linked-from-subpanel')).toBeInTheDocument();

    expect(mockUseReverseSpanLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        source: TRACE_SOURCE,
        traceId: 'trace-1',
        spanId: 'span-1',
        anchorDate: ANCHOR,
      }),
    );
  });

  it('hides the section when there are no reverse links', () => {
    mockUseReverseSpanLinks.mockReturnValue({ links: [] });

    renderWithMantine(
      <RowOverviewPanel source={TRACE_SOURCE} rowId="SpanId='span-1'" />,
    );

    expect(screen.queryByText('Linked from')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('linked-from-subpanel'),
    ).not.toBeInTheDocument();
  });

  it('passes undefined ids when the row lacks trace/span context', () => {
    mockUseRowData.mockReturnValue({ data: { data: [{}], meta: [] } });
    mockUseReverseSpanLinks.mockReturnValue({ links: [] });

    renderWithMantine(
      <RowOverviewPanel source={TRACE_SOURCE} rowId="SpanId='span-1'" />,
    );

    expect(mockUseReverseSpanLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: undefined,
        spanId: undefined,
      }),
    );
  });

  it("resolves the row's forward links and passes details to the span links panel", () => {
    const spanLink = {
      TraceId: 'linked-trace',
      SpanId: 'linked-span',
      TraceState: '',
      Attributes: {},
    };
    mockUseRowData.mockReturnValue({
      data: { data: [{ ...ROW, __hdx_span_links: [spanLink] }], meta: [] },
    });
    mockUseReverseSpanLinks.mockReturnValue({ links: [] });
    const details = new Map([
      ['linked-trace:linked-span', { TraceId: 'linked-trace' }],
    ]);
    mockUseLinkedSpanDetails.mockReturnValue({ details });

    renderWithMantine(
      <RowOverviewPanel source={TRACE_SOURCE} rowId="SpanId='span-1'" />,
    );

    expect(mockUseLinkedSpanDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        source: TRACE_SOURCE,
        links: [spanLink],
        anchorDate: ANCHOR,
      }),
    );
    expect(mockSpanLinksSubpanel).toHaveBeenCalledWith(
      expect.objectContaining({ linkedSpanDetails: details }),
    );
  });
});
