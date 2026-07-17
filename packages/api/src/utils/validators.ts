import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { isValidSlackUrl } from '@hyperdx/common-utils/dist/validation';
import { Address4, Address6 } from 'ip-address';
import { z } from 'zod';

import * as config from '@/config';

// Strips the surrounding brackets from IPv6 literals in URL hostnames (e.g. [::1] → ::1)
export const IPV6_BRACKET_RE = /^\[|\]$/g;

const ADDITIONAL_RESERVED_IPV4_SUBNETS = [
  new Address4('0.0.0.0/8'), // "this" network (RFC 1122)
  new Address4('192.0.0.0/24'), // IETF protocol assignments (RFC 6890)
  new Address4('198.18.0.0/15'), // benchmarking (RFC 2544)
  new Address4('192.0.2.0/24'), // TEST-NET-1 (RFC 5737)
  new Address4('198.51.100.0/24'), // TEST-NET-2 (RFC 5737)
  new Address4('203.0.113.0/24'), // TEST-NET-3 (RFC 5737)
  new Address4('240.0.0.0/4'), // reserved/future-use (RFC 1112 §4)
];

const IPV4_COMPATIBLE_SUBNET = new Address6('::/96');
const IPV4_MAPPED_SUBNET = new Address6('::ffff:0:0/96');
const IPV6_LINK_LOCAL_SUBNET = new Address6('fe80::/10');
const IPV6_DISCARD_ONLY_SUBNET = new Address6('100::/64');

// Returns true for private/reserved IPv4 and IPv6 addresses that must not be
// reachable from outbound requests (SSRF protection).
export function isPrivateIp(ip: string): boolean {
  if (Address4.isValid(ip)) {
    const addr = new Address4(ip);
    return (
      addr.isLoopback() ||
      addr.isPrivate() ||
      addr.isLinkLocal() ||
      addr.isMulticast() ||
      addr.isCGNAT() || // RFC 6598 100.64.0.0/10 shared address space
      addr.isUnspecified() ||
      ADDITIONAL_RESERVED_IPV4_SUBNETS.some(subnet => addr.isInSubnet(subnet))
    );
  }
  if (Address6.isValid(ip)) {
    const addr = new Address6(ip);
    // Check the embedded address in mapped and deprecated compatible forms.
    if (
      addr.isInSubnet(IPV4_MAPPED_SUBNET) ||
      addr.isInSubnet(IPV4_COMPATIBLE_SUBNET)
    ) {
      const v4 = addr.to4();
      if (v4 && Address4.isValid(v4.address)) {
        return isPrivateIp(v4.address);
      }
    }
    return (
      addr.isLoopback() ||
      addr.isLinkLocal() ||
      addr.isInSubnet(IPV6_LINK_LOCAL_SUBNET) ||
      addr.isULA() ||
      addr.isMulticast() ||
      addr.isUnspecified() ||
      addr.isDocumentation() ||
      addr.isInSubnet(IPV6_DISCARD_ONLY_SUBNET)
    );
  }
  return false;
}

const normalizeWebhookHostname = (hostname: string): string =>
  hostname.replace(IPV6_BRACKET_RE, '').replace(/\.+$/, '').toLowerCase();

const getWebhookHostKey = (url: URL): string =>
  `${normalizeWebhookHostname(url.hostname)}:${url.port}`;

const BLOCKED_WEBHOOK_HOSTS = (() => {
  const hosts = new Map<string, string>();
  const configuredHosts = {
    CLICKHOUSE_HOST: config.CLICKHOUSE_HOST,
    MONGO_URI: config.MONGO_URI,
  };

  for (const [configKey, configuredUrl] of Object.entries(configuredHosts)) {
    if (!configuredUrl) continue;
    try {
      hosts.set(getWebhookHostKey(new URL(configuredUrl)), configKey);
    } catch {
      // Invalid service configuration is handled by the service that owns it.
    }
  }

  return hosts;
})();

export class WebhookUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlValidationError';
  }
}

type WebhookUrlInput = {
  service: WebhookService;
  url?: string;
};

export function validateWebhookUrl(
  webhook: WebhookUrlInput,
): asserts webhook is WebhookUrlInput & { url: string } {
  if (!webhook.url) {
    throw new WebhookUrlValidationError('Webhook URL is not set');
  }

  let url: URL;
  try {
    url = new URL(webhook.url);
  } catch {
    throw new WebhookUrlValidationError('Webhook URL is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookUrlValidationError('Webhook URL must use HTTP or HTTPS');
  }

  if (
    webhook.service === WebhookService.Slack &&
    !isValidSlackUrl(webhook.url)
  ) {
    throw new WebhookUrlValidationError(
      `Slack Webhook URL ${webhook.url} does not have hostname that ends in 'slack.com'`,
    );
  }

  if (BLOCKED_WEBHOOK_HOSTS.has(getWebhookHostKey(url))) {
    throw new WebhookUrlValidationError(
      `Webhook attempting to query disallowed route.`,
    );
  }

  const hostname = normalizeWebhookHostname(url.hostname);
  const isLocalhost =
    hostname === 'localhost' || hostname.endsWith('.localhost');
  // Local webhook receivers are useful in development mode. Keep
  // numeric loopback addresses subject to isPrivateIp so the exemption stays
  // limited to the explicit localhost hostname convention.
  if ((!config.IS_DEV && isLocalhost) || isPrivateIp(hostname)) {
    throw new WebhookUrlValidationError(
      `Webhook URL resolves to a private or reserved address.`,
    );
  }
}

export const passwordSchema = z
  .string()
  .min(12, 'Password must have at least 12 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine(
    pass => /[a-z]/.test(pass) && /[A-Z]/.test(pass),
    'Password must include both lower and upper case characters',
  )
  .refine(pass => /\d/.test(pass), 'Password must include at least one number')
  .refine(
    pass => /[!@#$%^&*(),.?":{}|<>;\-+=]/.test(pass),
    'Password must include at least one special character',
  );

export const validatePassword = (password: string) => {
  return passwordSchema.safeParse(password).success;
};
