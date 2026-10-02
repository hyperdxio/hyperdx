// Mock for ky-universal ESM module
const ky = jest.fn(() => ({
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
  head: jest.fn(() => Promise.resolve({})),
}));

// Mock the create and extend methods to return the ky mock itself
// @ts-expect-error this exists
ky.create = jest.fn(() => ky);
// @ts-expect-error this exists
ky.extend = jest.fn(() => ky);

// Mirrors real ky's HTTPError shape so app code doing `instanceof HTTPError`
// works the same under test as it does at runtime, instead of silently
// resolving `HTTPError` to `undefined`.
class HTTPError extends Error {
  response: unknown;
  request: unknown;
  options: unknown;

  constructor(response: unknown, request?: unknown, options?: unknown) {
    super('Request failed');
    this.name = 'HTTPError';
    this.response = response;
    this.request = request;
    this.options = options;
  }
}
// @ts-expect-error this exists
ky.HTTPError = HTTPError;

module.exports = ky;
