import type { AgentAttribute } from '@/opamp/models/agent';

// AgentCapabilities bit flags from opamp.proto (the AgentCapabilities enum).
// Only the bits we surface on telemetry are named; unknown/future bits are
// ignored rather than rendered as opaque numbers.
const AGENT_CAPABILITY_FLAGS: ReadonlyArray<readonly [number, string]> = [
  [0x00000001, 'ReportsStatus'],
  [0x00000002, 'AcceptsRemoteConfig'],
  [0x00000004, 'ReportsEffectiveConfig'],
  [0x00000008, 'AcceptsPackages'],
  [0x00000010, 'ReportsPackageStatuses'],
  [0x00000020, 'ReportsOwnTraces'],
  [0x00000040, 'ReportsOwnMetrics'],
  [0x00000080, 'ReportsOwnLogs'],
  [0x00000100, 'AcceptsOpAMPConnectionSettings'],
  [0x00000200, 'AcceptsOtherConnectionSettings'],
  [0x00000400, 'AcceptsRestartCommand'],
  [0x00000800, 'ReportsHealth'],
  [0x00001000, 'ReportsRemoteConfig'],
  [0x00002000, 'ReportsHeartbeat'],
  [0x00004000, 'ReportsAvailableComponents'],
];

/**
 * Coerce a protobuf numeric field to a plain JS number. 64-bit fields (uint64 /
 * fixed64) decode to long.js `Long` objects when the `long` package is present
 * (it is), so a bare `typeof === 'number'` check silently misses them. Returns
 * undefined for absent or non-finite values.
 */
export function toSafeNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (
    value != null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Decode an AgentCapabilities bitmask into the list of enabled flag names, for
 * use as a human-readable, low-effort span attribute (e.g.
 * "ReportsStatus,AcceptsRemoteConfig,ReportsHealth").
 */
export function decodeAgentCapabilities(capabilities: unknown): string[] {
  const bits = toSafeNumber(capabilities);
  if (bits == null) {
    return [];
  }
  return AGENT_CAPABILITY_FLAGS.filter(([bit]) => (bits & bit) !== 0).map(
    ([, name]) => name,
  );
}

// RemoteConfigStatuses enum from opamp.proto. protobufjs decodes enum fields to
// their raw numeric wire value, so map back to a fixed set of names. This is an
// allowlist on purpose: the status is agent-supplied on an unauthenticated
// endpoint and used as a metric label, so anything outside the known values is
// bucketed to 'unknown' to keep time-series cardinality bounded.
const REMOTE_CONFIG_STATUS_NAMES: Record<number, string> = {
  0: 'UNSET',
  1: 'APPLIED',
  2: 'APPLYING',
  3: 'FAILED',
};

/**
 * Map a decoded RemoteConfigStatuses value (numeric or already a string) to its
 * bounded name. Returns undefined when no status was reported; unknown values
 * bucket to 'unknown' so the result is always safe as a metric dimension.
 */
export function remoteConfigStatusName(status: unknown): string | undefined {
  if (status == null) {
    return undefined;
  }
  if (typeof status === 'string') {
    // Accept a known name as-is; bucket anything else.
    return Object.values(REMOTE_CONFIG_STATUS_NAMES).includes(status)
      ? status
      : 'unknown';
  }
  const n = toSafeNumber(status);
  if (n == null) {
    return 'unknown';
  }
  return REMOTE_CONFIG_STATUS_NAMES[n] ?? 'unknown';
}

/**
 * Cap an agent-supplied string before it becomes a span attribute. Agent input
 * is bounded only by the request body limit (~10MB), so unbounded strings would
 * amplify trace ingestion/export cost on an unauthenticated endpoint.
 */
export function truncateAttr(value: string, max = 512): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Extract a scalar value for `key` from an OpAMP AgentDescription attribute
 * list (OTel-style key/value pairs). Returns undefined if the key is absent.
 */
export function getAgentAttribute(
  attributes: AgentAttribute[] | undefined,
  key: string,
): string | number | boolean | undefined {
  const attr = attributes?.find(a => a.key === key);
  if (!attr) {
    return undefined;
  }
  const { value } = attr;
  if (value.stringValue != null) return value.stringValue;
  if (value.intValue != null) return value.intValue;
  if (value.doubleValue != null) return value.doubleValue;
  if (value.boolValue != null) return value.boolValue;
  return undefined;
}
