/**
 * Zod issues as zod-express-middleware reports them: one entry per request
 * part it rejected, each carrying that part's parse issues.
 */
type ZodRequestErrors = {
  errors?: { issues?: { message?: unknown }[] };
}[];

const isZodRequestErrors = (body: unknown): body is ZodRequestErrors =>
  Array.isArray(body) && body.length > 0;

/**
 * Whether the error carries an HTTP response whose body we can read.
 *
 * Structural rather than `error instanceof HTTPError`: that identity holds
 * only while there is exactly one copy of ky in the module graph, and it is
 * unavailable under the ESM mock the app's tests run against. What actually
 * matters here is that there is a body to read.
 */
const hasJsonResponse = (
  error: unknown,
): error is { response: { json: () => Promise<unknown> } } =>
  error != null &&
  typeof error === 'object' &&
  'response' in error &&
  error.response != null &&
  typeof error.response === 'object' &&
  'json' in error.response &&
  typeof error.response.json === 'function';

/**
 * The reason the API gave for a failed request.
 *
 * ky throws `HTTPError` with a boilerplate message ("Request failed with
 * status code 400 Bad Request"); the reason is in the response body, in one of
 * two shapes:
 *
 *   - `{ message }` — thrown by a route/controller (see the API's error
 *     middleware, which serializes an operational error's name).
 *   - `[{ errors: { issues: [...] } }]` — a schema rejection from
 *     zod-express-middleware, before the handler ran.
 *
 * Every issue is reported, not just the first: one save can violate two rules,
 * and showing one at a time turns a fix into several round trips.
 *
 * Falls back for anything unrecognised, so a caller always has something to
 * show. Async because reading the body is.
 */
export async function getApiErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (hasJsonResponse(error)) {
    try {
      const body = await error.response.json();

      if (
        body != null &&
        typeof body === 'object' &&
        'message' in body &&
        typeof body.message === 'string' &&
        body.message.length > 0
      ) {
        return body.message;
      }

      if (isZodRequestErrors(body)) {
        const messages = body
          .flatMap(part => part.errors?.issues ?? [])
          .map(issue => issue.message)
          .filter((message): message is string => typeof message === 'string');
        if (messages.length > 0) {
          return messages.join('; ');
        }
      }
    } catch {
      // Body already consumed, or not JSON. Fall through to the caller's copy
      // rather than surfacing ky's status-line message, which tells the user
      // nothing they can act on.
    }
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
