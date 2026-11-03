import { Stack } from '@mantine/core';

import {
  getHttpMethod,
  getHttpProtocol,
  getHttpRoute,
  getHttpStatusCode,
  getHttpStatusText,
  getUserAgent,
} from '@/utils/httpSpanAttributes';
import { getHttpUrl } from '@/utils/httpUrl';
import {
  getRpcMetadata,
  getRpcMethod,
  getRpcServerAddress,
  getRpcStatus,
  getRpcSystemLabel,
  RpcStatus,
} from '@/utils/rpcSpanAttributes';
import {
  Attributes,
  firstSetString,
  getNetworkPeerAddress,
} from '@/utils/spanAttributeReaders';

import { HeaderSection, HttpMessageSections } from './HttpMessageSections';
import { RequestDetailRow, RequestDetailsTable } from './RequestDetailsTable';
import {
  formatHttpStatus,
  getRpcStatusBadge,
  RequestLine,
} from './RequestLine';

/** HTTP facts of gRPC over HTTP, e.g. `POST http://cart/x.Cart/Get · 200 OK`. */
function getHttpSummary(attributes: Attributes): string | undefined {
  const statusCode = getHttpStatusCode(attributes);
  const request = [getHttpMethod(attributes), getHttpUrl(attributes)]
    .filter(part => part != null)
    .join(' ');
  const status =
    statusCode != null
      ? formatHttpStatus(statusCode, getHttpStatusText(attributes, statusCode))
      : '';
  return [request, status].filter(Boolean).join(' · ') || undefined;
}

function getDetailRows(
  attributes: Attributes,
  spanKind: string | undefined,
  method: string | undefined,
  status: RpcStatus | undefined,
): RequestDetailRow[] {
  const errorType = firstSetString(attributes, ['error.type']);
  const route = getHttpRoute(attributes);
  return [
    ['Error message', firstSetString(attributes, ['grpc.error_message'])],
    // Instrumentations set error.type to the status, which the badge shows.
    [
      'Error type',
      errorType === status?.name || errorType === status?.code?.toString()
        ? undefined
        : errorType,
    ],
    ['Server', getRpcServerAddress(attributes, spanKind)],
    ['Remote address', getNetworkPeerAddress(attributes)],
    ['Protocol', getHttpProtocol(attributes)],
    ['HTTP', getHttpSummary(attributes)],
    // ASP.NET Core sets the route of a gRPC call to the method path.
    ['Route', route === `/${method}` ? undefined : route],
    ['User agent', getUserAgent(attributes)],
  ];
}

/** No copy-as-cURL: curl can't replay a gRPC call. */
export function RpcCallSubpanel({
  attributes,
  spanKind,
}: {
  attributes: Attributes;
  spanKind?: string;
}) {
  const method = getRpcMethod(attributes);
  const status = getRpcStatus(attributes);
  const hasError =
    firstSetString(attributes, ['grpc.error_message', 'error.type']) != null;

  return (
    <Stack gap="sm">
      <RequestLine
        label={getRpcSystemLabel(attributes)}
        target={method}
        status={getRpcStatusBadge(status, hasError)}
      />
      <RequestDetailsTable
        rows={getDetailRows(attributes, spanKind, method, status)}
      />
      <HttpMessageSections attributes={attributes}>
        <HeaderSection
          title="Request metadata"
          headers={getRpcMetadata(attributes, 'request')}
        />
        <HeaderSection
          title="Response metadata"
          headers={getRpcMetadata(attributes, 'response')}
        />
      </HttpMessageSections>
    </Stack>
  );
}
