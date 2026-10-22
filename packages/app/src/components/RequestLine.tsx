import type { CSSProperties } from 'react';
import { Badge, type BadgeProps } from '@clickhouse/click-ui';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTerminal } from '@tabler/icons-react';

import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';
import type { RpcStatus } from '@/utils/rpcSpanAttributes';

type RequestStatusBadge = { text: string; state: BadgeProps['state'] };

const NO_SHRINK = { flexShrink: 0 };
const BUTTON_STYLES = { label: { alignSelf: 'baseline' } };
const TARGET_STYLE: CSSProperties = {
  flex: '1 1 16rem',
  minWidth: 0,
  maxWidth: 'max-content',
  overflowWrap: 'anywhere',
};

// The legacy HyperDX browser SDK reports 0 when the request never got a
// response (network error, CORS, aborted).
export function formatHttpStatus(
  statusCode: number,
  statusText?: string,
): string {
  const text = statusText || (statusCode === 0 ? 'No response' : undefined);
  return text ? `${statusCode} ${text}` : `${statusCode}`;
}

function httpStatusState(statusCode: number): BadgeProps['state'] {
  if (statusCode >= 500 || statusCode === 0) return 'danger';
  if (statusCode >= 400) return 'warning';
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode >= 100 && statusCode < 400) return 'info';
  return 'neutral';
}

export function getHttpStatusBadge(
  statusCode: number,
  statusText?: string,
): RequestStatusBadge {
  return {
    text: formatHttpStatus(statusCode, statusText),
    state: httpStatusState(statusCode),
  };
}

/**
 * Falls back to an "Error" badge: some emitters record an error without a
 * status code.
 */
export function getRpcStatusBadge(
  status: RpcStatus | undefined,
  hasError: boolean,
): RequestStatusBadge | undefined {
  if (status != null) {
    return { text: status.label, state: status.isOk ? 'success' : 'danger' };
  }
  return hasError ? { text: 'Error', state: 'danger' } : undefined;
}

async function copyCurl(curl: string) {
  if (!(await copyTextToClipboard(curl))) {
    notifications.show({ color: 'red', message: CLIPBOARD_ERROR_MESSAGE });
    return;
  }
  notifications.show({
    color: 'green',
    message: 'cURL command copied to clipboard',
  });
}

/**
 * `METHOD url status` for HTTP, `system method status` for RPC, read like an
 * access log line.
 */
export function RequestLine({
  label,
  target,
  status,
  getCurl,
}: {
  /** HTTP method or RPC system. */
  label?: string;
  /** URL or RPC method. */
  target?: string;
  status?: RequestStatusBadge;
  /** Omit to hide the copy action, e.g. when curl can't replay the call. */
  getCurl?: () => string;
}) {
  return (
    <Group gap="xs" wrap="wrap" align="baseline">
      {label != null && (
        <Badge text={label} size="sm" state="neutral" style={NO_SHRINK} />
      )}
      {target != null && (
        <Text size="sm" ff="monospace" style={TARGET_STYLE}>
          {target}
        </Text>
      )}
      {status != null && (
        <Badge
          text={status.text}
          size="sm"
          state={status.state}
          style={NO_SHRINK}
        />
      )}
      {getCurl != null && (
        <Button
          variant="secondary"
          size="compact-xs"
          leftSection={<IconTerminal size={14} />}
          style={NO_SHRINK}
          styles={BUTTON_STYLES}
          onClick={() => copyCurl(getCurl())}
        >
          Copy as cURL
        </Button>
      )}
    </Group>
  );
}
