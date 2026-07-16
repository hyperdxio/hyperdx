import { Address4, Address6 } from 'ip-address';
import { z } from 'zod';

// Strips the surrounding brackets from IPv6 literals in URL hostnames (e.g. [::1] → ::1)
export const IPV6_BRACKET_RE = /^\[|\]$/g;

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
      addr.isUnspecified() || // 0.0.0.0 "this" network (RFC 1122)
      addr.isInSubnet(new Address4('240.0.0.0/4')) // reserved/future-use (RFC 1112 §4)
    );
  }
  if (Address6.isValid(ip)) {
    const addr = new Address6(ip);
    // IPv4-mapped (::ffff:x.x.x.x) — check the embedded v4 address
    if (addr.isInSubnet(new Address6('::ffff:0:0/96'))) {
      const v4 = addr.to4();
      if (v4 && Address4.isValid(v4.address)) {
        return isPrivateIp(v4.address);
      }
    }
    return (
      addr.isLoopback() ||
      addr.isLinkLocal() ||
      addr.isULA() ||
      addr.isMulticast()
    );
  }
  return false;
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
