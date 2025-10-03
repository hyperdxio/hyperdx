import path from 'path';

/**
 * Normalizes a base path: ensures it starts with '/', removes trailing '/',
 * and validates against common issues like path traversal or absolute URLs.
 * @param basePath - The raw base path from env var
 * @returns Normalized path or empty string if invalid
 */
function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || typeof basePath !== 'string') {
    return '';
  }

  const trimmed = basePath.trim();
  if (!trimmed) {
    return '';
  }

  // Validate: prevent full URLs on original trimmed input
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    console.warn(`Invalid base path detected: ${basePath}. Using empty path.`);
    return '';
  }

  // Ensure leading slash
  let normalized = trimmed;
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Remove trailing slash if present (except for root '/')
  if (normalized.endsWith('/') && normalized !== '/') {
    normalized = normalized.slice(0, -1);
  }

  // Validate: prevent path traversal
  if (normalized.includes('..')) {
    console.warn(`Invalid base path detected: ${basePath}. Using empty path.`);
    return '';
  }

  return normalized;
}

/**
 * Joins a base path with a relative path, normalizing the result.
 * @param base - Normalized base path
 * @param relative - Relative path to join
 * @returns Full joined path
 */
export function joinPath(base: string, relative: string): string {
  if (!base) return normalizeBasePath(relative);
  if (!relative.startsWith('/')) relative = '/' + relative;
  let joined = path.posix.join(base, relative);
  if (!joined.startsWith('/')) joined = '/' + joined;
  if (joined.endsWith('/') && joined !== '/') joined = joined.slice(0, -1);
  return joined;
}

/**
 * Gets the normalized frontend base path from HYPERDX_BASE_PATH env var.
 */
export function getFrontendBasePath(): string {
  return normalizeBasePath(process.env.HYPERDX_BASE_PATH);
}

/**
 * Gets the normalized API base path from HYPERDX_API_BASE_PATH env var.
 * Defaults to '/api' if empty, but allows override.
 */
export function getApiBasePath(): string {
  let apiPath = process.env.HYPERDX_API_BASE_PATH || '/api';
  if (!apiPath.startsWith('/')) apiPath = '/' + apiPath;
  return joinPath(normalizeBasePath(apiPath), '');
}

/**
 * Gets the normalized OTEL base path from HYPERDX_OTEL_BASE_PATH env var.
 */
export function getOtelBasePath(): string {
  return normalizeBasePath(process.env.HYPERDX_OTEL_BASE_PATH);
}
