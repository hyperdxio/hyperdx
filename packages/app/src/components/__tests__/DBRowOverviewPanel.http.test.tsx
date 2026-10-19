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

const mockDBRowJsonViewer = jest.fn();
jest.mock('../DBRowJsonViewer', () => ({
  __esModule: true,
  DBRowJsonViewer: (props: unknown) => {
    mockDBRowJsonViewer(props);
    return null;
  },
}));
const mockNetworkPropertySubpanel = jest.fn();
jest.mock('../NetworkPropertyPanel', () => ({
  __esModule: true,
  NetworkPropertySubpanel: (props: unknown) => {
    mockNetworkPropertySubpanel(props);
    return <div data-testid="network-subpanel" />;
  },
}));
jest.mock('../linkedSpans', () => ({
  __esModule: true,
  useReverseSpanLinks: () => ({ links: [] }),
  useLinkedSpanDetails: () => ({ details: new Map() }),
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
  eventAttributesExpression: 'SpanAttributes',
};

function renderWithAttributes(
  attributes: Record<string, unknown>,
  flattenedAttributes: Record<string, unknown> = attributes,
) {
  mockUseRowData.mockReturnValue({
    data: {
      data: [
        {
          SpanAttributes: attributes,
          __hdx_event_attributes: flattenedAttributes,
          __hdx_span_kind: 'Server',
        },
      ],
      meta: [],
    },
  });
  renderWithMantine(
    <RowOverviewPanel source={TRACE_SOURCE} rowId="SpanId='span-1'" />,
  );
}

describe('RowOverviewPanel request section', () => {
  beforeEach(() => {
    mockUseRowData.mockReset();
    mockDBRowJsonViewer.mockReset();
    mockNetworkPropertySubpanel.mockReset();
  });

  it.each([
    ['HTTP Request', { 'url.path': '/users', 'http.request.method': 'GET' }],
    // Pre-1.21 server spans often carry no http.url.
    ['HTTP Request', { 'http.method': 'GET', 'http.target': '/users' }],
    ['gRPC Call', { 'rpc.system': 'grpc', 'rpc.method': 'GetQuote' }],
    [
      'gRPC Call',
      { 'grpc.method': '/x.Cart/Empty', 'url.path': '/x.Cart/Empty' },
    ],
    ['RPC Call', { 'rpc.service': 'S3', 'rpc.method': 'PutObject' }],
  ])('opens the "%s" panel for %o', (title, attributes) => {
    renderWithAttributes(attributes);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(mockNetworkPropertySubpanel).toHaveBeenCalledWith({
      eventAttributes: attributes,
      spanKind: 'Server',
    });
  });

  it('detects HTTP spans from a JSON attributes column', () => {
    renderWithAttributes(
      { url: { path: '/users' }, http: { request: { method: 'GET' } } },
      { 'url.path': '/users', 'http.request.method': 'GET' },
    );

    expect(screen.getByText('HTTP Request')).toBeInTheDocument();
  });

  it('hides the panel for a span that is neither HTTP nor RPC', () => {
    renderWithAttributes({ 'db.system': 'clickhouse' });

    expect(screen.queryByTestId('network-subpanel')).not.toBeInTheDocument();
  });

  it('keeps http.* attributes in the span attributes viewer', () => {
    const attributes = {
      'url.full': 'https://example-app.clickhouse.com/users',
      'http.request.method': 'GET',
      'http.request.header.x_forwarded_for': '1.2.3.4',
    };
    renderWithAttributes(attributes);

    expect(screen.getByTestId('network-subpanel')).toBeInTheDocument();
    expect(mockDBRowJsonViewer).toHaveBeenCalledWith(
      expect.objectContaining({ data: { SpanAttributes: attributes } }),
    );
  });
});
