import { z } from 'zod';
import HyperDX from '@hyperdx/browser';

import {
  APP_VERSION,
  BASE_PATH,
  IS_ALERT_DETAILS_ENABLED,
  IS_CLICKHOUSE_BUILD,
  IS_DASHBOARD_VARIABLES_ENABLED,
  IS_DEV,
  IS_LOCAL_MODE,
  IS_OSS,
  IS_PROMQL_ENABLED,
} from '@/config';
import { copyTextToClipboard } from '@/utils/clipboard';

// `window.hdx` — a small, namespaced debug handle for the browser console.
//
// The motivating ask is "which build is actually deployed here?".
// The frontend and backend deploy separately in prod, so we report BOTH:
//   - `appVersion` — the frontend build, from package.json.
//   - `serverVersion` — the API build (its CODE_VERSION), fetched from the
//     Express API's /api/health. Independent of the frontend's own version.
// It also gathers the context worth attaching when filing an issue: who/where
// (userId, teamId), the enabled feature set, device/browser info, the RUM
// session id, and a one-shot `report()` that bundles it all into text to drop
// straight into a bug report.

// Device Info
type HdxDevice = {
  screen: string;
  viewport: string;
  dpr: number;
  platform: string;
  language: string;
  userAgent: string;
};

type HdxDebug = {
  /** Frontend version (from package.json). */
  readonly appVersion: string;
  /** Backend/API version (its CODE_VERSION), or undefined until fetched. */
  readonly serverVersion?: string;
  /** Logged-in user id, once known (set from AppNav). */
  readonly userId?: string;
  /** Current team id, once known (set from AppNav). */
  readonly teamId?: string;
  readonly build: {
    isOss: boolean;
    isLocalMode: boolean;
    isClickhouseBuild: boolean;
    isDev: boolean;
    basePath: string;
  };
  /** Enabled-feature snapshot (static config flags + per-user toggles). */
  readonly features: Record<string, boolean>;
  /** Screen/viewport/OS/browser info. */
  readonly device: HdxDevice;
  /** The current RUM session id, if session recording is active. */
  sessionId: () => string | undefined;
  /** Human-readable multi-line summary for pasting into a bug report. */
  report: () => string;
  /** Copy `report()` to the clipboard; resolves to the copied text. */
  copy: () => Promise<string>;
};

declare global {
  interface Window {
    hdx?: HdxDebug;
  }
}

// Mutable module state, read live via the getters on window.hdx. `null` server
// version = not fetched yet; a string (possibly '') = the API's CODE_VERSION.
let cachedServerVersion: string | null = null;
let userId: string | undefined;
let teamId: string | undefined;
let dynamicFeatures: Record<string, boolean> = {};

// Only env-configurable flags are worth reporting — the hardcoded-true/false
// ones (k8s dashboard, metrics, sessions, materialized views) are the same in
// every deployment and would just be noise.
const staticFeatures: Record<string, boolean> = {
  promql: IS_PROMQL_ENABLED,
  dashboardVariables: IS_DASHBOARD_VARIABLES_ENABLED,
  alertDetails: IS_ALERT_DETAILS_ENABLED,
};

// config.ts's IS_OSS has a precedence quirk (`?? 'true' === 'true'`), so a set
// NEXT_PUBLIC_IS_OSS surfaces as a raw string — including "false", which is
// truthy. Normalize to the intended boolean (OSS unless explicitly "false")
// just for this debug surface, without changing IS_OSS itself.
const isOss = String(IS_OSS) !== 'false';

// Express /health returns more than this; we only care about the version.
const HealthResponseSchema = z.object({ version: z.string().optional() });

/**
 * Fetch the API's version from the Express /health endpoint (proxied under
 * /api). The API deploys separately from the frontend, so this is the only
 * authoritative source for the backend build. Resolves to undefined on any
 * failure (local mode has no API, network errors, etc.).
 */
export async function fetchServerVersion(): Promise<string | undefined> {
  if (IS_LOCAL_MODE) return undefined;
  try {
    const res = await fetch(`${BASE_PATH}/api/health`);
    if (!res.ok) return undefined;
    const parsed = HealthResponseSchema.safeParse(await res.json());
    const version = parsed.success ? (parsed.data.version ?? '') : '';
    cachedServerVersion = version;
    return version || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record user/team identity and per-user feature toggles. Called from a
 * component that already holds the `me` response (see AppNav). window.hdx reads
 * these live, so no re-install is needed.
 */
export function setHdxIdentity(next: {
  userId?: string;
  teamId?: string;
  features?: Record<string, boolean>;
}): void {
  userId = next.userId;
  teamId = next.teamId;
  dynamicFeatures = next.features ?? {};
}

// The RUM SDK only initializes in non-local mode and after /api/config resolves,
// so this accessor must tolerate it being absent.
function safeSessionId(): string | undefined {
  try {
    return HyperDX.getSessionId();
  } catch {
    return undefined;
  }
}

function getDevice(): HdxDevice {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const scr = typeof screen !== 'undefined' ? screen : undefined;
  return {
    screen: scr ? `${scr.width}x${scr.height}` : '',
    viewport:
      typeof window !== 'undefined'
        ? `${window.innerWidth}x${window.innerHeight}`
        : '',
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    // navigator.platform is deprecated but still the simplest OS hint and is
    // universally supported; userAgent carries the full detail below.
    platform: nav?.platform ?? '',
    language: nav?.language ?? '',
    userAgent: nav?.userAgent ?? '',
  };
}

function allFeatures(): Record<string, boolean> {
  return { ...staticFeatures, ...dynamicFeatures };
}

function enabledFeatureList(): string {
  const on = Object.entries(allFeatures())
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length ? on.join(', ') : 'none';
}

function buildReport(): string {
  const device = getDevice();
  const lines = [
    `frontend: ${APP_VERSION}`,
    `backend:  ${cachedServerVersion || 'unknown'}`,
    `mode:     ${IS_LOCAL_MODE ? 'local' : isOss ? 'oss' : 'cloud'}${
      IS_CLICKHOUSE_BUILD ? ' (clickstack)' : ''
    }`,
    ...(userId ? [`user:     ${userId}`] : []),
    ...(teamId ? [`team:     ${teamId}`] : []),
    `features: ${enabledFeatureList()}`,
    `url:      ${typeof window !== 'undefined' ? window.location.href : ''}`,
    `screen:   ${device.screen} (viewport ${device.viewport}, dpr ${device.dpr})`,
    `platform: ${device.platform}`,
    `language: ${device.language}`,
    `ua:       ${device.userAgent}`,
    `session:  ${safeSessionId() || 'N/A'}`,
  ];
  return lines.join('\n');
}

/**
 * Install `window.hdx` once. No-op during SSR or if already installed —
 * asynchronously-resolved fields are read live via getters, so this never needs
 * to run more than once.
 */
export function installHdxDebug(): void {
  if (typeof window === 'undefined' || window.hdx) {
    return;
  }

  window.hdx = {
    get appVersion() {
      return APP_VERSION;
    },
    get serverVersion() {
      return cachedServerVersion || undefined;
    },
    get userId() {
      return userId;
    },
    get teamId() {
      return teamId;
    },
    build: {
      isOss,
      isLocalMode: IS_LOCAL_MODE,
      isClickhouseBuild: IS_CLICKHOUSE_BUILD,
      isDev: IS_DEV,
      basePath: BASE_PATH,
    },
    get features() {
      return allFeatures();
    },
    get device() {
      return getDevice();
    },
    sessionId: safeSessionId,
    report: buildReport,
    copy: async () => {
      const text = buildReport();
      // Shared util handles the insecure-context / permissions fallback; the
      // returned text lets the caller copy manually if it still fails.
      await copyTextToClipboard(text);
      return text;
    },
  };
}
