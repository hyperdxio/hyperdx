import { getApiErrorMessage } from '@/utils/apiErrors';

const FALLBACK = 'Failed to create alert.';

/**
 * A ky HTTPError as the helper sees it: a boilerplate message, and the reason
 * in the response body.
 */
const httpError = (body: unknown, { json = true }: { json?: boolean } = {}) =>
  Object.assign(new Error('Request failed with status code 400 Bad Request'), {
    response: {
      json: json
        ? async () => body
        : async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
    },
  });

describe('getApiErrorMessage', () => {
  // What a route/controller throws — the reason a raw SQL inline alert was
  // rejected, for instance, which the user has to act on.
  it('reads the reason a route reported', async () => {
    await expect(
      getApiErrorMessage(
        httpError({ message: 'Source does not belong to the connection' }),
        FALLBACK,
      ),
    ).resolves.toBe('Source does not belong to the connection');
  });

  it('reads a schema rejection, reporting every issue', async () => {
    const body = [
      {
        type: 'Body',
        errors: {
          issues: [
            { message: 'thresholdMax must be greater than threshold' },
            { message: 'At least one notification channel is required' },
          ],
        },
      },
    ];

    await expect(getApiErrorMessage(httpError(body), FALLBACK)).resolves.toBe(
      'thresholdMax must be greater than threshold; At least one notification channel is required',
    );
  });

  it('falls back rather than showing ky’s status-line message', async () => {
    // A body with neither shape, an empty message, and a non-JSON body: none
    // of them say anything the user can act on.
    await expect(
      getApiErrorMessage(httpError({ unexpected: true }), FALLBACK),
    ).resolves.toBe(FALLBACK);
    await expect(
      getApiErrorMessage(httpError({ message: '' }), FALLBACK),
    ).resolves.toBe(FALLBACK);
    await expect(
      getApiErrorMessage(httpError(null, { json: false }), FALLBACK),
    ).resolves.toBe(FALLBACK);
  });

  it('uses a non-HTTP error’s own message', async () => {
    await expect(
      getApiErrorMessage(new Error('Network request failed'), FALLBACK),
    ).resolves.toBe('Network request failed');
  });

  it('falls back for a thrown non-error', async () => {
    await expect(getApiErrorMessage('nope', FALLBACK)).resolves.toBe(FALLBACK);
    await expect(getApiErrorMessage(undefined, FALLBACK)).resolves.toBe(
      FALLBACK,
    );
  });
});
