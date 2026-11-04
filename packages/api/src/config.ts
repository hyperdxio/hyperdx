import crypto from 'crypto';

const env = process.env;

// DEFAULTS
const DEFAULT_APP_TYPE = 'api';
const DEFAULT_FRONTEND_URL = env.HYPERDX_APP_PORT
  ? `http://localhost:${env.HYPERDX_APP_PORT}`
  : '';

export const NODE_ENV = env.NODE_ENV as string;

export const APP_TYPE = (env.APP_TYPE || DEFAULT_APP_TYPE) as
  | 'api'
  | 'scheduled-task';
export const CODE_VERSION = env.CODE_VERSION ?? '';
// Only for single container local deployments, disable authentication
export const IS_LOCAL_APP_MODE =
  env.IS_LOCAL_APP_MODE === 'DANGEROUSLY_is_local_app_mode💀';
const LEGACY_PUBLIC_SESSION_SECRET = 'hyperdx is cool 👋';
// Authenticated deployments never use the public demo secret. Without a safe
// configured value, generate one per process (sessions end on restart).
export const IS_EXPRESS_SESSION_SECRET_GENERATED =
  !env.EXPRESS_SESSION_SECRET ||
  (!IS_LOCAL_APP_MODE &&
    env.EXPRESS_SESSION_SECRET === LEGACY_PUBLIC_SESSION_SECRET);
export const EXPRESS_SESSION_SECRET =
  !IS_EXPRESS_SESSION_SECRET_GENERATED && env.EXPRESS_SESSION_SECRET
    ? env.EXPRESS_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');
export const FRONTEND_URL = (env.FRONTEND_URL ||
  DEFAULT_FRONTEND_URL) as string;
const HYPERDX_IMAGE = env.HYPERDX_IMAGE;
export const IS_APP_IMAGE = HYPERDX_IMAGE === 'hyperdx';
export const IS_ALL_IN_ONE_IMAGE = HYPERDX_IMAGE === 'all-in-one-auth';
export const IS_LOCAL_IMAGE = HYPERDX_IMAGE === 'all-in-one-noauth';
// On Vercel preview deployments the API is inlined into the Next.js app and
// shares its origin, so we emit relative redirects (FRONTEND_URL there points
// at the production host). Everywhere else the API and app run on separate
// hosts, so absolute URLs anchored at FRONTEND_URL are required.
export const IS_INLINE_API = env.HDX_PREVIEW_INLINE_API === 'true';
export const FRONTEND_REDIRECT_BASE = IS_INLINE_API ? '' : FRONTEND_URL;
export const SESSION_MAX_AGE_SECONDS =
  env.SESSION_MAX_AGE_SECONDS === undefined
    ? undefined
    : Number(env.SESSION_MAX_AGE_SECONDS);
export const SESSION_IDLE_TIMEOUT_SECONDS = Number(
  env.SESSION_IDLE_TIMEOUT_SECONDS ?? 2592000,
);
for (const [name, value] of Object.entries({
  SESSION_MAX_AGE_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
})) {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value <= 0 || value > 2592000)
  ) {
    throw new Error(`${name} must be an integer between 1 and 2592000 seconds`);
  }
}
if (
  SESSION_MAX_AGE_SECONDS &&
  SESSION_IDLE_TIMEOUT_SECONDS > SESSION_MAX_AGE_SECONDS
) {
  throw new Error(
    'SESSION_IDLE_TIMEOUT_SECONDS must not exceed SESSION_MAX_AGE_SECONDS',
  );
}
export const INGESTION_API_KEY = env.INGESTION_API_KEY ?? '';
// Opt-in: emit the contrib `datadogreceiver` on the collector so a
// Datadog Agent can ship APM traces (DD trace API -> OTLP -> ClickHouse).
// Off by default because the receiver has no per-team bearer-token auth like
// `otlp/hyperdx`, so enabling it opens an unauthenticated ingest port (:8126).
export const ENABLE_DATADOG_RECEIVER = env.ENABLE_DATADOG_RECEIVER === 'true';
export const HYPERDX_API_KEY = env.HYPERDX_API_KEY as string;
export const HYPERDX_LOG_LEVEL = env.HYPERDX_LOG_LEVEL as string;
export const IS_CI = NODE_ENV === 'test';
export const IS_DEV = NODE_ENV === 'development';
export const IS_PROD = NODE_ENV === 'production';
export const KEYCLOAK_REQUIRED = env.KEYCLOAK_REQUIRED === 'true';
export const KEYCLOAK = (() => {
  if (
    env.KEYCLOAK_REQUIRED &&
    !['true', 'false'].includes(env.KEYCLOAK_REQUIRED)
  ) {
    throw new Error('Keycloak: KEYCLOAK_REQUIRED must be true or false');
  }
  if (
    !env.KEYCLOAK_ISSUER &&
    !env.KEYCLOAK_CLIENT_ID &&
    !env.KEYCLOAK_CLIENT_SECRET &&
    !KEYCLOAK_REQUIRED
  )
    return;

  if (!env.KEYCLOAK_ISSUER || !env.KEYCLOAK_CLIENT_ID || IS_LOCAL_APP_MODE) {
    throw new Error(
      'Keycloak requires an issuer, client ID, and authenticated app mode',
    );
  }
  try {
    const issuer = new URL(env.KEYCLOAK_ISSUER);
    const frontend = new URL(FRONTEND_URL);
    for (const url of [issuer, frontend]) {
      const localHttp =
        !IS_PROD &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        (url.protocol !== 'https:' && !localHttp) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    }
    if (frontend.pathname !== '/') throw new Error();
    return {
      issuer: env.KEYCLOAK_ISSUER,
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      callbackUrl: new URL('/api/login/keycloak/callback', frontend).href,
    };
  } catch {
    throw new Error(
      'Keycloak requires an HTTPS issuer and FRONTEND_URL origin (HTTP loopback allowed outside production)',
    );
  }
})();
export const MONGO_URI = env.MONGO_URI;
export const OTEL_SERVICE_NAME = env.OTEL_SERVICE_NAME as string;
export const PORT = Number.parseInt(env.PORT as string);
export const OPAMP_PORT = Number.parseInt(env.OPAMP_PORT as string);
export const USAGE_STATS_ENABLED = env.USAGE_STATS_ENABLED !== 'false';
export const WEBHOOK_HOSTNAME_ALLOWLIST = env.WEBHOOK_HOSTNAME_ALLOWLIST ?? '';
export const RUN_SCHEDULED_TASKS_EXTERNALLY =
  env.RUN_SCHEDULED_TASKS_EXTERNALLY === 'true';

// 32-byte key (base64 or hex). Setting it is what turns on encryption of
// stored third-party tokens; unset means they are stored in plain text. See
// utils/tokenEncryption.ts.
export const TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;

// Only used to bootstrap empty instances
export const DEFAULT_CONNECTIONS = env.DEFAULT_CONNECTIONS;
export const DEFAULT_SOURCES = env.DEFAULT_SOURCES;

export const IS_PROMQL_ENABLED = env.ENABLE_PROMQL === 'true';

export const EXTERNAL_API_RATE_LIMIT_MAX = (() => {
  const parsed = Number(env.EXTERNAL_API_RATE_LIMIT_MAX);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 100;
})();

export const EXTERNAL_API_SEARCH_DEFAULT_MAX_RESULTS = 100;

export const EXTERNAL_API_SEARCH_MAX_RESULTS = (() => {
  const parsed = Number(env.EXTERNAL_API_SEARCH_MAX_RESULTS);
  // A cap below the default would make requests without maxResults invalid.
  return Number.isSafeInteger(parsed) &&
    parsed >= EXTERNAL_API_SEARCH_DEFAULT_MAX_RESULTS
    ? parsed
    : 2000;
})();

// FOR CI ONLY
export const CLICKHOUSE_HOST = env.CLICKHOUSE_HOST as string;
export const CLICKHOUSE_USER = env.CLICKHOUSE_USER as string;
export const CLICKHOUSE_PASSWORD = env.CLICKHOUSE_PASSWORD as string;

// AI Assistant
// Provider-agnostic configuration (preferred)
export const AI_PROVIDER = env.AI_PROVIDER as string; // 'anthropic' | 'openai'
export const AI_API_KEY = env.AI_API_KEY as string;
export const AI_BASE_URL = env.AI_BASE_URL as string;
export const AI_MODEL_NAME = env.AI_MODEL_NAME as string;
export const AI_REQUEST_HEADERS = env.AI_REQUEST_HEADERS as string;

// Legacy Anthropic-specific configuration (backward compatibility)
export const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY as string;
