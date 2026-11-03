import React from 'react';
import { notifications } from '@mantine/notifications';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { NetworkPropertySubpanel } from '@/components/NetworkPropertyPanel';
import { copyTextToClipboard } from '@/utils/clipboard';
import type { Attributes } from '@/utils/spanAttributeReaders';

jest.mock('@/utils/clipboard', () => ({
  CLIPBOARD_ERROR_MESSAGE: 'clipboard error',
  copyTextToClipboard: jest.fn(),
}));

jest.mock('@mantine/notifications', () => ({
  ...jest.requireActual('@mantine/notifications'),
  notifications: { show: jest.fn() },
}));

// click-ui encodes the badge state only in hashed CSS module class names.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({ text, state }: { text: React.ReactNode; state?: string }) => (
    <span data-testid="badge" data-state={state}>
      {text}
    </span>
  ),
}));

const mockCopy = jest.mocked(copyTextToClipboard);

const HTTP_CLIENT_SPAN = {
  'url.scheme': 'https',
  'server.address': 'example-api.clickhouse.com',
  'url.path': '/users',
  'http.request.method': 'POST',
  'http.response.status_code': 503,
  'error.type': '503',
  'http.request.header.x_forwarded_for': '1.2.3.4',
  'http.request.header.traceparent': '["00-0d98-cef1-01"]',
  'http.request.body.content': '{"name":"a"}',
  'http.response.body.content': 'a'.repeat(8192),
  'http.response.body.size': '23817',
};

const GRPC_CALL = {
  'rpc.method': 'GetQuote',
  'rpc.service': 'demo.QuoteService',
  'rpc.system': 'grpc',
  'server.address': '127.0.0.1',
  'server.port': '3002',
};

const renderPanel = (eventAttributes: Attributes, spanKind?: string) =>
  renderWithMantine(
    <NetworkPropertySubpanel {...{ eventAttributes, spanKind }} />,
  );
const getBadge = (text: string) =>
  screen.getByText(text, { selector: '[data-testid="badge"]' });
const getRow = (label: string) => screen.getByText(label).closest('tr');
const copyButton = () => screen.queryByRole('button', { name: 'Copy as cURL' });

describe('NetworkPropertySubpanel', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('HTTP request', () => {
    it('renders the request line, headers and bodies of a client span', () => {
      renderPanel(HTTP_CLIENT_SPAN);

      expect(getBadge('POST')).toBeInTheDocument();
      expect(
        screen.getByText('https://example-api.clickhouse.com/users'),
      ).toBeInTheDocument();
      expect(getBadge('503 Service Unavailable').dataset.state).toBe('danger');
      // Instrumentations set error.type to the status code the badge shows.
      expect(screen.queryByText('Error type')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Request headers (2)'));
      expect(screen.getByText('X-Forwarded-For')).toHaveAttribute(
        'title',
        'http.request.header.x_forwarded_for',
      );
      expect(
        screen.getByText('Response body (truncated: 8.0 KB of 23.3 KB)'),
      ).toBeInTheDocument();
    });

    it('renders a hostless request that got no response', () => {
      // The HyperDX browser SDK reports status 0 for a request with no response.
      renderPanel({
        'http.method': 'GET',
        'http.target': '/users',
        'http.status_code': '0',
      });
      expect(screen.getByText('/users')).toBeInTheDocument();
      expect(getBadge('0 No response').dataset.state).toBe('danger');
      // curl needs an absolute URL.
      expect(copyButton()).not.toBeInTheDocument();
    });

    it('renders the details of a semconv server span', () => {
      renderPanel({
        'client.address': '::1',
        'error.type': 'timeout',
        'http.request.method': 'GET',
        'http.route': '/api/hello',
        'network.peer.address': '::1',
        'network.peer.port': '49347',
      });

      expect(getRow('Route')).toHaveTextContent('/api/hello');
      expect(getRow('Remote address')).toHaveTextContent('[::1]:49347');
      expect(getRow('Error type')).toHaveTextContent('timeout');
      // The client is the socket peer, already shown as the remote address.
      expect(screen.queryByText('Client address')).not.toBeInTheDocument();
    });

    it.each([
      [true, { color: 'green', message: 'cURL command copied to clipboard' }],
      [false, { color: 'red', message: 'clipboard error' }],
    ])('copies a cURL command (copied: %s)', async (copied, notification) => {
      mockCopy.mockResolvedValue(copied);
      renderPanel(HTTP_CLIENT_SPAN);
      fireEvent.click(screen.getByRole('button', { name: 'Copy as cURL' }));

      await waitFor(() =>
        expect(notifications.show).toHaveBeenCalledWith(notification),
      );
      const curl = mockCopy.mock.calls[0][0];
      expect(curl).toContain('-X POST');
      expect(curl).toContain('-H "X-Forwarded-For: 1.2.3.4"');
      expect(curl).not.toContain('traceparent');
      expect(curl).toContain(`--data-raw '{"name":"a"}'`);
    });
  });

  describe('RPC call', () => {
    it('renders a gRPC error with its metadata and no cURL action', () => {
      renderPanel({
        ...GRPC_CALL,
        'grpc.error_message': '5 NOT_FOUND: no quote for missing',
        'rpc.grpc.status_code': '5',
        'rpc.request.metadata.x_request_id': '["cb88b510"]',
        'rpc.response.metadata.x_quote_source': '["pricing-v2"]',
      });

      expect(getBadge('gRPC')).toBeInTheDocument();
      expect(
        screen.getByText('demo.QuoteService/GetQuote'),
      ).toBeInTheDocument();
      expect(getBadge('5 NOT_FOUND').dataset.state).toBe('danger');
      expect(getRow('Error message')).toHaveTextContent(
        '5 NOT_FOUND: no quote for missing',
      );
      expect(copyButton()).not.toBeInTheDocument();

      expect(screen.getByText('Response metadata (1)')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Request metadata (1)'));
      expect(screen.getByText('x-request-id')).toHaveAttribute(
        'title',
        'rpc.request.metadata.x_request_id',
      );
    });

    it('puts the HTTP facts of gRPC over HTTP in one row', () => {
      renderPanel({
        ...GRPC_CALL,
        'http.request.method': 'POST',
        'http.response.status_code': '200',
        'http.route': '/demo.QuoteService/GetQuote',
        'url.path': '/demo.QuoteService/GetQuote',
        'url.scheme': 'http',
      });

      expect(getRow('HTTP')).toHaveTextContent(
        'POST http://127.0.0.1:3002/demo.QuoteService/GetQuote · 200 OK',
      );
      expect(screen.queryByText('Route')).not.toBeInTheDocument();
    });

    it('shows an "Error" badge for an error without a status code', () => {
      renderPanel({ ...GRPC_CALL, 'grpc.error_message': 'card expired' });
      expect(getBadge('Error').dataset.state).toBe('danger');
    });

    it('reads the server from net.peer.name only on a client span', () => {
      const call = { 'rpc.system': 'grpc', 'net.peer.name': 'checkout' };
      const { unmount } = renderPanel(call, 'Client');
      expect(getRow('Server')).toHaveTextContent('checkout');
      unmount();

      // On a server span net.peer.* is the caller.
      renderPanel(call, 'Server');
      expect(screen.queryByText('Server')).not.toBeInTheDocument();
    });
  });
});
