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

module.exports = ky;
