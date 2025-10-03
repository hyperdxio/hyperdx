import {
  getApiBasePath,
  getFrontendBasePath,
  getOtelBasePath,
  joinPath,
} from '../basePath';

describe('basePath utilities', () => {
  describe('getFrontendBasePath', () => {
    it('returns empty string if no env var', () => {
      delete process.env.HYPERDX_BASE_PATH;
      expect(getFrontendBasePath()).toBe('');
    });

    it('returns normalized path for valid input', () => {
      process.env.HYPERDX_BASE_PATH = '/hyperdx';
      expect(getFrontendBasePath()).toBe('/hyperdx');

      process.env.HYPERDX_BASE_PATH = 'hyperdx/';
      expect(getFrontendBasePath()).toBe('/hyperdx');

      process.env.HYPERDX_BASE_PATH = '/hyperdx/';
      expect(getFrontendBasePath()).toBe('/hyperdx');
    });

    it('returns empty for invalid paths', () => {
      process.env.HYPERDX_BASE_PATH = '/../invalid';
      expect(getFrontendBasePath()).toBe('');

      process.env.HYPERDX_BASE_PATH = 'http://example.com';
      expect(getFrontendBasePath()).toBe('');
    });
  });

  describe('getApiBasePath', () => {
    it('defaults to /api if no env var', () => {
      delete process.env.HYPERDX_API_BASE_PATH;
      expect(getApiBasePath()).toBe('/api');
    });

    it('uses env var if set', () => {
      process.env.HYPERDX_API_BASE_PATH = '/hyperdx/api';
      expect(getApiBasePath()).toBe('/hyperdx/api');
    });

    it('normalizes input', () => {
      process.env.HYPERDX_API_BASE_PATH = 'hyperdx/api/';
      expect(getApiBasePath()).toBe('/hyperdx/api');
    });
  });

  describe('getOtelBasePath', () => {
    it('returns empty if no env var', () => {
      delete process.env.HYPERDX_OTEL_BASE_PATH;
      expect(getOtelBasePath()).toBe('');
    });

    it('returns normalized path', () => {
      process.env.HYPERDX_OTEL_BASE_PATH = '/hyperdx/otel';
      expect(getOtelBasePath()).toBe('/hyperdx/otel');
    });
  });

  describe('joinPath', () => {
    it('joins empty base with relative', () => {
      expect(joinPath('', '/test')).toBe('/test');
    });

    it('joins valid base and relative', () => {
      expect(joinPath('/hyperdx', '/api')).toBe('/hyperdx/api');
      expect(joinPath('/hyperdx', 'api')).toBe('/hyperdx/api');
    });

    it('normalizes joined path', () => {
      expect(joinPath('/hyperdx/', '/api/')).toBe('/hyperdx/api');
    });
  });
});
