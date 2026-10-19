import React from 'react';
import { notifications } from '@mantine/notifications';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { NetworkPropertySubpanel } from '@/components/NetworkPropertyPanel';
import { copyTextToClipboard } from '@/utils/clipboard';

jest.mock('@/utils/clipboard', () => ({
  __esModule: true,
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
const mockShowNotification = jest.mocked(notifications.show);

const CLIENT_SPAN = {
  'url.scheme': 'https',
  'server.address': 'example-api.clickhouse.com',
  'url.path': '/users',
  'url.query': 'id=1',
  'http.request.method': 'POST',
  'http.response.status_code': 503,
  'network.peer.address': '10.0.0.1',
  'http.request.header.x_forwarded_for': '1.2.3.4',
  'http.request.header.traceparent': '["00-0d98-cef1-01"]',
  'http.request.body.content': '{"name":"a"}',
  'http.response.header.content-type': '["application/json"]',
  'http.response.body.content': '{"error":"down"}',
};

const renderPanel = (eventAttributes: Record<string, unknown>) =>
  renderWithMantine(
    <NetworkPropertySubpanel eventAttributes={eventAttributes} />,
  );

const getBadge = (text: string) =>
  screen.getByText(text, { selector: '[data-testid="badge"]' });

function getDetail(label: string) {
  const row = screen.getByText(label).closest('tr');
  if (row == null) throw new Error(`No row for ${label}`);
  return within(row).getAllByRole('cell')[1];
}

describe('NetworkPropertySubpanel', () => {
  beforeEach(() => {
    mockCopy.mockReset().mockResolvedValue(true);
    mockShowNotification.mockReset();
  });

  it('renders the method, URL and status on one request line', () => {
    renderPanel(CLIENT_SPAN);

    expect(getBadge('POST')).toHaveAttribute('data-state', 'neutral');
    expect(
      screen.getByText('https://example-api.clickhouse.com/users?id=1'),
    ).toBeInTheDocument();
    expect(getBadge('503 Service Unavailable')).toBeInTheDocument();
  });

  it.each([
    ['200', '200 OK', 'success'],
    ['299', '299', 'success'],
    ['304', '304 Not Modified', 'info'],
    ['404', '404 Not Found', 'warning'],
    ['503', '503 Service Unavailable', 'danger'],
    // The HyperDX browser SDK reports 0 for a request that got no response.
    ['0', '0 No response', 'danger'],
  ])('shows status %s as "%s" (%s)', (code, text, state) => {
    renderPanel({ 'http.method': 'GET', 'http.status_code': code });
    expect(getBadge(text)).toHaveAttribute('data-state', state);
  });

  it('renders the details of a semconv server span', () => {
    renderPanel({
      'client.address': '::1',
      'http.request.method': 'GET',
      'http.response.status_code': '200',
      'http.route': '/api/hello',
      'network.peer.address': '::1',
      'network.peer.port': '49347',
      'network.protocol.version': '1.1',
      'server.address': 'localhost',
      'server.port': '3001',
      'url.path': '/api/hello',
      'url.scheme': 'http',
      'user_agent.original': 'Mozilla/5.0 Chrome/155.0.0.0',
    });

    expect(screen.getByText('http://localhost:3001/api/hello')).toBeVisible();
    expect(getDetail('Route')).toHaveTextContent('/api/hello');
    expect(getDetail('Protocol')).toHaveTextContent('HTTP/1.1');
    expect(getDetail('Remote address')).toHaveTextContent('[::1]:49347');
    expect(getDetail('User agent')).toHaveTextContent(
      'Mozilla/5.0 Chrome/155.0.0.0',
    );
    // The client is the socket peer, already shown as the remote address.
    expect(screen.queryByText('Client address')).not.toBeInTheDocument();
  });

  it('shows sizes, resends and a synthetic user agent', () => {
    renderPanel({
      ...CLIENT_SPAN,
      'http.request.body.size': '1536',
      'http.request.size': '1900',
      'http.response.body.size': '87',
      'http.request.resend_count': '2',
      'user_agent.original': 'Googlebot/2.1',
      'user_agent.synthetic.type': 'bot',
    });

    expect(getDetail('Request size')).toHaveTextContent(
      '1.5 KB body · 1.9 KB total',
    );
    expect(getDetail('Response size')).toHaveTextContent('87 B body');
    expect(getDetail('Resends')).toHaveTextContent('2');
    expect(getBadge('bot')).toHaveAttribute('data-state', 'neutral');
  });

  it('shows the error type unless it repeats the status code', () => {
    const { unmount } = renderPanel({ ...CLIENT_SPAN, 'error.type': '503' });
    expect(screen.queryByText('Error type')).not.toBeInTheDocument();
    unmount();

    renderPanel({ ...CLIENT_SPAN, 'error.type': '_OTHER' });
    expect(getDetail('Error type')).toHaveTextContent('_OTHER');
  });

  it('lists headers by dashed name with the raw key on hover', () => {
    renderPanel(CLIENT_SPAN);

    expect(screen.getByText('Request body')).toBeInTheDocument();
    expect(screen.getByText('Response headers (1)')).toBeInTheDocument();
    expect(screen.getByText('Response body')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Request headers (2)'));

    expect(screen.getByText('X-Forwarded-For')).toHaveAttribute(
      'title',
      'http.request.header.x_forwarded_for',
    );
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
  });

  it('flags a body cut short of its reported size', () => {
    renderPanel({
      ...CLIENT_SPAN,
      'http.response.body.content': 'a'.repeat(8192),
      'http.response.body.size': '23817',
    });

    expect(
      screen.getByText('Response body (truncated: 8.0 KB of 23.3 KB)'),
    ).toBeInTheDocument();
  });

  it('renders a deprecated client span', () => {
    renderPanel({
      'http.url': 'https://old-example.clickhouse.com/a',
      'http.method': 'GET',
      'http.status_code': '404',
      'http.status_text': 'Page Gone',
      'net.peer.ip': '10.0.0.2',
      'net.peer.port': '8080',
      'http.flavor': '1.1',
      'http.user_agent': 'python-requests/2.32.3',
    });

    expect(
      screen.getByText('https://old-example.clickhouse.com/a'),
    ).toBeInTheDocument();
    expect(getBadge('404 Page Gone')).toHaveAttribute('data-state', 'warning');
    expect(getDetail('Remote address')).toHaveTextContent('10.0.0.2:8080');
    expect(getDetail('Protocol')).toHaveTextContent('HTTP/1.1');
    expect(getDetail('User agent')).toHaveTextContent('python-requests/2.32.3');
  });

  it('copies a cURL command without the trace header', async () => {
    renderPanel(CLIENT_SPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as cURL' }));

    await waitFor(() =>
      expect(mockShowNotification).toHaveBeenCalledWith({
        color: 'green',
        message: 'cURL command copied to clipboard',
      }),
    );
    const curl = mockCopy.mock.calls[0][0];
    expect(curl).toContain(
      'curl https://example-api.clickhouse.com/users?id=1',
    );
    expect(curl).toContain('-X POST');
    expect(curl).toContain('-H "X-Forwarded-For: 1.2.3.4"');
    expect(curl).not.toContain('traceparent');
    expect(curl).toContain(`--data-raw '{"name":"a"}'`);
  });

  it('reports a clipboard failure', async () => {
    mockCopy.mockResolvedValue(false);
    renderPanel(CLIENT_SPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as cURL' }));

    await waitFor(() =>
      expect(mockShowNotification).toHaveBeenCalledWith({
        color: 'red',
        message: 'clipboard error',
      }),
    );
  });

  it('hides the cURL action for a URL without a host', () => {
    renderPanel({ 'http.method': 'GET', 'http.target': '/users' });

    expect(screen.getByText('/users')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy as cURL' }),
    ).not.toBeInTheDocument();
  });
});
