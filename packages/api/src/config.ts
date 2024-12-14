// DEFAULTS
const DEFAULT_APP_TYPE = 'api';
const DEFAULT_EXPRESS_SESSION = 'hyperdx is cool 👋';

const env = process.env;
export const NODE_ENV = env.NODE_ENV as string;

export const APP_TYPE = (env.APP_TYPE || DEFAULT_APP_TYPE) as
  | 'api'
  | 'scheduled-task';
export const CODE_VERSION = env.CODE_VERSION as string;
export const EXPRESS_SESSION_SECRET = (env.EXPRESS_SESSION_SECRET ||
  DEFAULT_EXPRESS_SESSION) as string;
export const FRONTEND_URL = env.FRONTEND_URL as string;
export const HYPERDX_API_KEY = env.HYPERDX_API_KEY as string;
export const HYPERDX_LOG_LEVEL = env.HYPERDX_LOG_LEVEL as string;
export const IS_CI = NODE_ENV === 'ci';
export const IS_DEV = NODE_ENV === 'development';
export const IS_PROD = NODE_ENV === 'production';
export const MINER_API_URL = env.MINER_API_URL as string;
export const MONGO_URI = env.MONGO_URI;
export const OTEL_SERVICE_NAME = env.OTEL_SERVICE_NAME as string;
export const PORT = Number.parseInt(env.PORT as string);
export const REDIS_URL = env.REDIS_URL;
export const USAGE_STATS_ENABLED = env.USAGE_STATS_ENABLED !== 'false';

// Only for single container local deployments, disable authentication
export const IS_LOCAL_APP_MODE =
  env.IS_LOCAL_APP_MODE === 'DANGEROUSLY_is_local_app_mode💀';
