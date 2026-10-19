import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { RowOverviewPanel } from '@/components/DBRowOverviewPanel';

let mockRow: Record<string, unknown>;
jest.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ data: { data: [mockRow] } }),
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

const mockDBRowJsonViewer = jest.fn();
jest.mock('../DBRowJsonViewer', () => ({
  DBRowJsonViewer: (props: unknown) => mockDBRowJsonViewer(props),
}));

const mockNetworkPropertySubpanel = jest.fn();
jest.mock('../NetworkPropertyPanel', () => ({
  NetworkPropertySubpanel: (props: unknown) =>
    mockNetworkPropertySubpanel(props),
}));

jest.mock('../linkedSpans', () => ({
  useReverseSpanLinks: () => ({ links: [] }),
  useLinkedSpanDetails: () => ({ details: new Map() }),
}));

// `any`, not `as`, keeps this partial fixture off the lint warning budget.
const asSource = (value: any): TSource => value;
const TRACE_SOURCE = asSource({
  kind: SourceKind.Trace,
  eventAttributesExpression: 'SpanAttributes',
});

function renderSpan(attributes: Record<string, unknown>) {
  mockRow = {
    SpanAttributes: attributes,
    __hdx_event_attributes: attributes,
    __hdx_span_kind: 'Server',
  };
  renderWithMantine(<RowOverviewPanel source={TRACE_SOURCE} rowId="span-1" />);
}

describe('RowOverviewPanel request section', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['HTTP Request', { 'url.path': '/users', 'http.request.method': 'GET' }],
    // Pre-1.21 server spans often carry no http.url.
    ['HTTP Request', { 'http.method': 'GET', 'http.target': '/users' }],
    ['gRPC Call', { 'rpc.system': 'grpc', 'rpc.method': 'GetQuote' }],
    ['RPC Call', { 'rpc.service': 'S3', 'rpc.method': 'PutObject' }],
  ])('opens the "%s" panel for %o', (title, attributes) => {
    renderSpan(attributes);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(mockNetworkPropertySubpanel).toHaveBeenCalledWith({
      eventAttributes: attributes,
      spanKind: 'Server',
    });
    // The panel no longer strips http.* keys from the attributes viewer.
    expect(mockDBRowJsonViewer).toHaveBeenCalledWith(
      expect.objectContaining({ data: { SpanAttributes: attributes } }),
    );
  });

  it('hides the panel for a span that is neither HTTP nor RPC', () => {
    renderSpan({ 'db.system': 'clickhouse' });
    expect(mockNetworkPropertySubpanel).not.toHaveBeenCalled();
  });
});
