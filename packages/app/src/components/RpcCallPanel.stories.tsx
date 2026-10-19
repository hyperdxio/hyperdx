import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { NetworkPropertySubpanel } from './NetworkPropertyPanel';

// Rendered through NetworkPropertySubpanel, the overview's entry point, so
// spans with both RPC and HTTP attributes take the same path as in the app.
// The attributes come from real OTel Node and ASP.NET Core spans.
const meta = {
  title: 'Components/RpcCallPanel',
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

const nodeClientAttributes = {
  'rpc.method': 'GetQuote',
  'rpc.response.metadata.x_quote_source': '["pricing-v2"]',
  'rpc.service': 'demo.QuoteService',
  'rpc.system': 'grpc',
  'server.address': '127.0.0.1',
  'server.port': '3002',
};

export const GrpcNodeClientOk: Story = {
  args: {
    eventAttributes: {
      ...nodeClientAttributes,
      'rpc.grpc.status_code': '0',
      'rpc.request.metadata.x_request_id':
        '["f8f85da1-5fa7-4baa-a66f-69d521029ff9"]',
    },
  },
};

export const GrpcNodeClientError: Story = {
  args: {
    eventAttributes: {
      ...nodeClientAttributes,
      'grpc.error_message': '5 NOT_FOUND: no quote for missing',
      'grpc.error_name': 'Error',
      'rpc.grpc.status_code': '5',
      'rpc.request.metadata.x_request_id':
        '["cb88b510-b001-4477-9f37-7ce1d8299b97"]',
    },
  },
};

export const GrpcNodeServerErrorWithHttp: Story = {
  args: {
    eventAttributes: {
      ...nodeClientAttributes,
      'grpc.error_message': 'no quote for missing',
      'grpc.error_name': 'Error',
      'http.request.header.content-type': '["application/grpc"]',
      'http.request.method': 'POST',
      'http.response.status_code': '200',
      'http.route': '/demo.QuoteService/GetQuote',
      'network.protocol.name': 'http',
      'network.protocol.version': '2',
      'rpc.grpc.status_code': '5',
      'rpc.request.metadata.x_request_id':
        '["cb88b510-b001-4477-9f37-7ce1d8299b97"]',
      'url.path': '/demo.QuoteService/GetQuote',
      'url.scheme': 'http',
      'user_agent.original': 'grpc-node-js/1.14.6',
    },
  },
};

export const GrpcAspNetCoreServer: Story = {
  args: {
    eventAttributes: {
      'grpc.method': '/demo.QuoteService/GetQuote',
      'grpc.status_code': '0',
      'http.request.method': 'POST',
      'http.response.status_code': '200',
      'http.route': '/demo.QuoteService/GetQuote',
      'network.protocol.version': '2',
      'server.address': 'quote',
      'server.port': '8080',
      'url.path': '/demo.QuoteService/GetQuote',
      'url.scheme': 'http',
      'user_agent.original':
        'grpc-dotnet/2.67.0 (.NET 9.0.0; CLR 9.0.0; net9.0; osx; arm64)',
    },
  },
};
