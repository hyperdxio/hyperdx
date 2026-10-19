import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';

import { NetworkPropertySubpanel } from '@/components/NetworkPropertyPanel';

// click-ui encodes the badge state only in hashed CSS module class names.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({ text, state }: { text: React.ReactNode; state?: string }) => (
    <span data-testid="badge" data-state={state}>
      {text}
    </span>
  ),
}));

const GRPC_CALL = {
  'rpc.method': 'GetQuote',
  'rpc.service': 'demo.QuoteService',
  'rpc.system': 'grpc',
  'server.address': '127.0.0.1',
  'server.port': '3002',
};

const renderPanel = (eventAttributes: Record<string, string>) =>
  renderWithMantine(
    <NetworkPropertySubpanel eventAttributes={eventAttributes} />,
  );

const getBadge = (text: string) =>
  screen.getByText(text, { selector: '[data-testid="badge"]' });
const badgeTexts = () =>
  screen.queryAllByTestId('badge').map(badge => badge.textContent);

function getDetail(label: string) {
  const row = screen.getByText(label).closest('tr');
  if (row == null) throw new Error(`No row for ${label}`);
  return within(row).getAllByRole('cell')[1];
}

const copyButton = () => screen.queryByRole('button', { name: 'Copy as cURL' });

describe('RPC call panel', () => {
  it('renders a gRPC client error with its metadata', () => {
    renderPanel({
      ...GRPC_CALL,
      'grpc.error_message': '5 NOT_FOUND: no quote for missing',
      'rpc.grpc.status_code': '5',
      'rpc.request.metadata.x_request_id': '["cb88b510"]',
      'rpc.response.metadata.x_quote_source': '["pricing-v2"]',
    });

    expect(getBadge('gRPC')).toHaveAttribute('data-state', 'neutral');
    expect(screen.getByText('demo.QuoteService/GetQuote')).toBeInTheDocument();
    expect(getBadge('5 NOT_FOUND')).toHaveAttribute('data-state', 'danger');
    expect(getDetail('Error message')).toHaveTextContent(
      '5 NOT_FOUND: no quote for missing',
    );
    expect(getDetail('Server')).toHaveTextContent('127.0.0.1:3002');
    expect(screen.queryByText('HTTP')).not.toBeInTheDocument();
    expect(copyButton()).not.toBeInTheDocument();

    expect(screen.getByText('Response metadata (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Request metadata (1)'));
    expect(screen.getByText('x-request-id')).toHaveAttribute(
      'title',
      'rpc.request.metadata.x_request_id',
    );
    expect(screen.getByText('cb88b510')).toBeInTheDocument();
  });

  it('puts the HTTP facts of gRPC over HTTP in a details row', () => {
    renderPanel({
      ...GRPC_CALL,
      'error.type': 'NOT_FOUND',
      'http.request.header.content-type': '["application/grpc"]',
      'http.request.method': 'POST',
      'http.response.status_code': '200',
      'http.route': '/demo.QuoteService/GetQuote',
      'network.protocol.version': '2',
      'rpc.grpc.status_code': '5',
      'url.path': '/demo.QuoteService/GetQuote',
      'url.scheme': 'http',
    });

    expect(badgeTexts()).toEqual(['gRPC', '5 NOT_FOUND']);
    expect(getDetail('HTTP')).toHaveTextContent(
      'POST http://127.0.0.1:3002/demo.QuoteService/GetQuote · 200 OK',
    );
    expect(getDetail('Protocol')).toHaveTextContent('HTTP/2');
    expect(screen.queryByText('Route')).not.toBeInTheDocument();
    expect(screen.queryByText('Error type')).not.toBeInTheDocument();
    expect(screen.getByText('Request headers (1)')).toBeInTheDocument();
    expect(copyButton()).not.toBeInTheDocument();
  });

  it('reads the ASP.NET Core gRPC tags', () => {
    renderPanel({
      'grpc.method': '/demo.QuoteService/GetQuote',
      'grpc.status_code': '0',
      'http.request.method': 'POST',
    });

    expect(screen.getByText('demo.QuoteService/GetQuote')).toBeInTheDocument();
    expect(getBadge('0 OK')).toHaveAttribute('data-state', 'success');
  });

  it('shows the system and status of another RPC system as emitted', () => {
    renderPanel({
      'rpc.method': 'acme.v1.UserService/GetUser',
      'rpc.status_code': 'not_found',
      'rpc.system': 'connect_rpc',
    });

    expect(badgeTexts()).toEqual(['connect_rpc', 'not_found']);
    expect(getBadge('not_found')).toHaveAttribute('data-state', 'danger');
  });

  it('shows an "Error" badge for an error without a status code', () => {
    renderPanel({ ...GRPC_CALL, 'grpc.error_message': 'card expired' });

    expect(getBadge('Error')).toHaveAttribute('data-state', 'danger');
    expect(getDetail('Error message')).toHaveTextContent('card expired');
  });
});
