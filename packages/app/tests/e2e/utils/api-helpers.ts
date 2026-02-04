/**
 * API Helper utilities for E2E tests
 *
 * Provides common functions for interacting with the HyperDX API
 * in end-to-end tests, including authentication and resource access.
 */
import { Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL || 'http://localhost:29000';

/**
 * Fetches the current user's access key for API authentication
 *
 * @param page - Playwright page instance with authenticated session
 * @returns The user's access key (Bearer token)
 * @throws If the user endpoint fails or access key is not available
 *
 * @example
 * ```typescript
 * const accessKey = await getUserAccessKey(page);
 * const response = await page.request.get(`${API_URL}/api/v2/dashboards`, {
 *   headers: { 'Authorization': `Bearer ${accessKey}` }
 * });
 * ```
 */
export async function getUserAccessKey(page: Page): Promise<string> {
  const userResponse = await page.request.get(`${API_URL}/me`);

  if (!userResponse.ok()) {
    throw new Error(
      `Failed to fetch user data: ${userResponse.status()} ${userResponse.statusText()}`,
    );
  }

  const userData = await userResponse.json();

  if (!userData.accessKey) {
    throw new Error('User access key not found in response');
  }

  return userData.accessKey;
}

/**
 * Fetches available data sources for the authenticated user's team
 *
 * @param page - Playwright page instance with authenticated session
 * @param kind - Optional filter for source kind ('log', 'trace', 'metric', 'session')
 * @returns Array of source objects (filtered by kind if specified)
 * @throws If the sources endpoint fails or no sources match the filter
 *
 * @example Get all sources
 * ```typescript
 * const sources = await getSources(page);
 * const firstSourceId = sources[0]._id;
 * ```
 *
 * @example Get log sources only
 * ```typescript
 * const logSources = await getSources(page, 'log');
 * const logSourceId = logSources[0]._id;
 * ```
 */
export async function getSources(
  page: Page,
  kind?: 'log' | 'trace' | 'metric' | 'session',
): Promise<any[]> {
  const sourcesResponse = await page.request.get(`${API_URL}/sources`);

  if (!sourcesResponse.ok()) {
    throw new Error(
      `Failed to fetch sources: ${sourcesResponse.status()} ${sourcesResponse.statusText()}`,
    );
  }

  const sources = await sourcesResponse.json();

  if (!Array.isArray(sources)) {
    throw new Error('Invalid sources response: expected an array');
  }

  // Filter by kind if specified
  if (kind) {
    const filteredSources = sources.filter(source => source.kind === kind);
    if (filteredSources.length === 0) {
      throw new Error(
        `No sources found with kind '${kind}'. Available sources: ${sources.map(s => `${s.name} (${s.kind})`).join(', ')}`,
      );
    }
    return filteredSources;
  }

  return sources;
}

/**
 * Gets the API base URL
 *
 * @returns The API base URL
 */
export function getApiUrl(): string {
  return API_URL;
}
