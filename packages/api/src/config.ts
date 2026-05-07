const env = process.env;

// DEFAULTS
const DEFAULT_APP_TYPE = 'api';
const DEFAULT_EXPRESS_SESSION = 'berg is cool';
const DEFAULT_FRONTEND_URL = `http://localhost:${env.BERG_APP_PORT}`;

function requireEnv(name: string): string {
  const v = env[name];
  if (!v) {
    throw new Error(`Required env var ${name} is not set`);
  }
  return v;
}

export const NODE_ENV = env.NODE_ENV as string;

export const APP_TYPE = (env.APP_TYPE || DEFAULT_APP_TYPE) as
  | 'api'
  | 'scheduled-task';
export const CODE_VERSION = env.CODE_VERSION ?? '';
export const EXPRESS_SESSION_SECRET = (env.EXPRESS_SESSION_SECRET ||
  DEFAULT_EXPRESS_SESSION) as string;
export const FRONTEND_URL = (env.FRONTEND_URL ||
  DEFAULT_FRONTEND_URL) as string;
const BERG_IMAGE = env.BERG_IMAGE;
export const IS_APP_IMAGE = BERG_IMAGE === 'hyperdx';
export const IS_ALL_IN_ONE_IMAGE = BERG_IMAGE === 'all-in-one-auth';
export const IS_LOCAL_IMAGE = BERG_IMAGE === 'all-in-one-noauth';
export const BERG_API_KEY = env.BERG_API_KEY as string;
export const BERG_LOG_LEVEL = env.BERG_LOG_LEVEL as string;
export const IS_CI = NODE_ENV === 'test';
export const IS_DEV = NODE_ENV === 'development';
export const IS_PROD = NODE_ENV === 'production';
export const MINER_API_URL = env.MINER_API_URL as string;
export const MONGO_URI = env.MONGO_URI;
export const OTEL_SERVICE_NAME = env.OTEL_SERVICE_NAME as string;
export const PORT = Number.parseInt(env.PORT as string);
export const USAGE_STATS_ENABLED = env.USAGE_STATS_ENABLED !== 'false';
export const RUN_SCHEDULED_TASKS_EXTERNALLY =
  env.RUN_SCHEDULED_TASKS_EXTERNALLY === 'true';

// Only for single container local deployments, disable authentication
export const IS_LOCAL_APP_MODE =
  env.IS_LOCAL_APP_MODE === 'DANGEROUSLY_is_local_app_mode💀';

// Only used to bootstrap empty instances
export const DEFAULT_SOURCES = env.DEFAULT_SOURCES;

// AWS Athena (Berg). Required at runtime; optional during CI/test where the
// Athena client is not exercised.
function lazyRequireEnv(name: string): string {
  if (IS_CI) {
    return env[name] ?? '';
  }
  return requireEnv(name);
}

export const ATHENA_REGION = lazyRequireEnv('ATHENA_REGION');
export const ATHENA_WORKGROUP = lazyRequireEnv('ATHENA_WORKGROUP');
export const ATHENA_OUTPUT_LOCATION = lazyRequireEnv('ATHENA_OUTPUT_LOCATION');

export const ATHENA_SYNC_TIMEOUT_MS = Number.parseInt(
  env.ATHENA_SYNC_TIMEOUT_MS ?? '30000',
  10,
);
export const ATHENA_RESULT_REUSE_TTL_MIN = Number.parseInt(
  env.ATHENA_RESULT_REUSE_TTL_MIN ?? '60',
  10,
);

// Glue catalog scoping (Berg).
//
// GLUE_CATALOG_ID — single Glue catalog ID surfaced to the UI.  S3 Tables
// register as `<account>:s3tablescatalog/<bucket>`-style federated catalogs;
// set this to the catalog you want users to browse.  If unset, falls back to
// the default account-level catalog (`AwsDataCatalog`).
//
// GLUE_DATABASES — comma-separated allowlist of database names (Glue
// namespaces) to expose under the catalog.  If unset, all databases the
// IAM role can see are listed.  Lets a deployment narrow the surface to a
// single tenant's data without relying on IAM grants alone.
export const GLUE_CATALOG_ID = env.GLUE_CATALOG_ID || 'AwsDataCatalog';
export const GLUE_DATABASES: string[] = (env.GLUE_DATABASES ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// AI Assistant
// Provider-agnostic configuration (preferred)
export const AI_PROVIDER = env.AI_PROVIDER as string; // 'anthropic' | 'openai'
export const AI_API_KEY = env.AI_API_KEY as string;
export const AI_BASE_URL = env.AI_BASE_URL as string;
export const AI_MODEL_NAME = env.AI_MODEL_NAME as string;
export const AI_REQUEST_HEADERS = env.AI_REQUEST_HEADERS as string;

// Legacy Anthropic-specific configuration (backward compatibility)
export const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY as string;
