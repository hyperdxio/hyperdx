import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { NetworkPropertySubpanel } from './NetworkPropertyPanel';

const meta = {
  title: 'Components/NetworkPropertyPanel',
  component: NetworkPropertySubpanel,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div style={{ width: 900 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkPropertySubpanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const semconvClientErrorAttributes = {
  'url.full':
    'https://example-api.clickhouse.com/v2/charges/ch_3Nq8xY2eZvKYlo2C1a9b/refunds?expand[]=customer&expand[]=invoice.subscription&idempotency_key=7f9c1a2e-4b3d-4e8f-9a6b-2c1d0e9f8a7b&locale=en-US&return_url=https%3A%2F%2Fshop.example.com%2Fcheckout%2Fcomplete%3Forder%3D84213',
  'http.request.method': 'POST',
  'http.response.status_code': '429',
  'network.peer.address': '10.0.4.12',
  'network.peer.port': '443',
  'network.protocol.version': '2',
  'server.address': 'example-api.clickhouse.com',
  'server.port': '443',
  'http.request.resend_count': '2',
  'error.type': '429',
  'http.request.body.size': '512',
  'http.response.body.size': '87',
  'http.request.header.content-type': '["application/json"]',
  'http.request.header.x_forwarded_for': '1.2.3.4',
  'http.response.header.retry-after': '["30"]',
  'http.request.body.content':
    '{"amount":4200,"currency":"usd","reason":"requested_by_customer","metadata":{"order_id":"84213"}}',
  'http.response.body.content':
    '{"error":{"type":"rate_limit_error","message":"Too many requests"}}',
};

export const SemconvServer: Story = {
  args: {
    eventAttributes: {
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
      'user_agent.original':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    },
  },
};

export const SemconvClientError: Story = {
  args: { eventAttributes: semconvClientErrorAttributes },
};

export const ServerError: Story = {
  args: {
    eventAttributes: {
      'http.request.method': 'GET',
      'http.response.status_code': '503',
      'http.route': '/orders/{id}',
      'url.path': '/orders/42',
      'url.query': 'expand=items',
      'url.scheme': 'https',
      'server.address': 'example-api.clickhouse.com',
      'server.port': '443',
      'client.address': '203.0.113.9',
      'network.peer.address': '10.0.0.5',
      'network.peer.port': '38122',
      'network.protocol.version': '1.1',
      'user_agent.original': 'okhttp/4.12.0',
      'error.type': '_OTHER',
      'http.request.header.accept': '["application/json"]',
      'http.request.header.x-request-id':
        '["5d0c7f3e-2a1b-4c9d-8e7f-6a5b4c3d2e1f"]',
      'http.response.header.content-type': '["application/json"]',
      'http.response.header.retry-after': '["5"]',
    },
  },
};

export const DeprecatedClient: Story = {
  args: {
    eventAttributes: {
      'http.url': 'http://example-api.clickhouse.com:8080/api/items/9921',
      'http.method': 'GET',
      'http.status_code': '404',
      'http.status_text': 'Not Found',
      'net.peer.ip': '10.0.0.2',
      'net.peer.port': '8080',
      'http.flavor': '1.1',
      'http.user_agent': 'python-requests/2.32.3',
    },
  },
};

export const DeprecatedServer: Story = {
  args: {
    eventAttributes: {
      'http.method': 'GET',
      'http.scheme': 'http',
      'http.host': 'frontend-proxy:8080',
      'http.target': '/api/products/0PUK6V6EV0?currency=USD',
      'http.status_code': '200',
      'http.status_text': 'OK',
      'net.host.name': 'frontend-proxy',
      'net.host.port': '8080',
      'net.sock.peer.addr': '10.116.11.86',
      'net.sock.peer.port': '51514',
      'http.flavor': '2.0',
      'http.user_agent': 'python-requests/2.32.3',
      'net.transport': 'ip_tcp',
    },
  },
};

export const FailedBrowserRequest: Story = {
  args: {
    eventAttributes: {
      'http.url': 'https://example-api.clickhouse.com/v1/cart',
      'http.method': 'POST',
      'http.status_code': '0',
      'http.request.body': '{"items":[1,2]}',
    },
  },
};

// The ClickStack Node and Python SDKs keep the first 8192 bytes of a body and
// report the full size in http.*.body.size.
export const TruncatedBody: Story = {
  args: {
    eventAttributes: {
      'http.request.method': 'GET',
      'http.response.status_code': '200',
      'http.route': '/api/products',
      'url.path': '/api/products',
      'url.scheme': 'http',
      'server.address': 'catalog',
      'server.port': '8080',
      'http.response.body.size': '23817',
      'http.response.body.content': JSON.stringify({
        products: Array.from({ length: 200 }, (_, i) => ({
          id: `SKU-${String(i + 1).padStart(4, '0')}`,
          name: `Product ${i + 1}`,
          priceUsd: { currencyCode: 'USD', units: 10 + i, nanos: 990000000 },
        })),
      }).slice(0, 8192),
    },
  },
};

export const Narrow: Story = {
  args: { eventAttributes: semconvClientErrorAttributes },
  decorators: [
    Story => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
