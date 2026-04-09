describe('Per-signal OTLP endpoint configuration', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('config.ts env var resolution', () => {
    it('should default per-signal URLs to undefined when not set', () => {
      delete process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      delete process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;

      const config = require('../config');
      expect(config.HDX_TRACES_URL).toBeUndefined();
      expect(config.HDX_LOGS_URL).toBeUndefined();
    });

    it('should read NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', () => {
      process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
        'http://traces-host:4318/v1/traces';

      const config = require('../config');
      expect(config.HDX_TRACES_URL).toBe('http://traces-host:4318/v1/traces');
    });

    it('should read NEXT_PUBLIC_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', () => {
      process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT =
        'http://logs-host:4318/v1/logs';

      const config = require('../config');
      expect(config.HDX_LOGS_URL).toBe('http://logs-host:4318/v1/logs');
    });

    it('should fall back to non-prefixed env vars', () => {
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
        'http://traces-host:4318/v1/traces';
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT =
        'http://logs-host:4318/v1/logs';

      const config = require('../config');
      expect(config.HDX_TRACES_URL).toBe('http://traces-host:4318/v1/traces');
      expect(config.HDX_LOGS_URL).toBe('http://logs-host:4318/v1/logs');
    });

    it('should prefer NEXT_PUBLIC_ prefix over non-prefixed', () => {
      process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
        'http://public-traces:4318/v1/traces';
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
        'http://internal-traces:4318/v1/traces';

      const config = require('../config');
      expect(config.HDX_TRACES_URL).toBe('http://public-traces:4318/v1/traces');
    });

    it('should not affect base collector URL when per-signal vars are set', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4318';
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
        'http://traces-host:4318/v1/traces';

      const config = require('../config');
      expect(config.HDX_COLLECTOR_URL).toBe('http://base-collector:4318');
      expect(config.HDX_TRACES_URL).toBe('http://traces-host:4318/v1/traces');
    });
  });

  describe('browser SDK URL derivation', () => {
    function deriveCollectorUrl(config: {
      collectorUrl: string;
      tracesUrl?: string;
      logsUrl?: string;
    }): string {
      // Replicate the logic from _app.tsx
      const tracesBase = config.tracesUrl?.replace(/\/v1\/traces\/?$/, '');
      return tracesBase ?? config.collectorUrl;
    }

    it('should use collectorUrl when no per-signal URLs are set', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://collector:4318',
      });
      expect(url).toBe('http://collector:4318');
    });

    it('should derive base URL from traces endpoint with /v1/traces suffix', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://collector:4318',
        tracesUrl: 'http://traces-host:4318/v1/traces',
      });
      expect(url).toBe('http://traces-host:4318');
    });

    it('should derive base URL from traces endpoint with trailing slash', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://collector:4318',
        tracesUrl: 'http://traces-host:4318/v1/traces/',
      });
      expect(url).toBe('http://traces-host:4318');
    });

    it('should use full traces URL as base when no /v1/traces suffix', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://collector:4318',
        tracesUrl: 'http://traces-host:4318',
      });
      expect(url).toBe('http://traces-host:4318');
    });

    it('should prefer tracesUrl over collectorUrl', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://default-collector:4318',
        tracesUrl: 'http://dedicated-traces:4318/v1/traces',
      });
      expect(url).toBe('http://dedicated-traces:4318');
    });

    it('should ignore logsUrl for base URL derivation', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://collector:4318',
        logsUrl: 'http://logs-host:4318/v1/logs',
      });
      expect(url).toBe('http://collector:4318');
    });

    it('should handle traces URL with path prefix', () => {
      const url = deriveCollectorUrl({
        collectorUrl: 'http://collector:4318',
        tracesUrl: 'http://traces-host:4318/prefix/v1/traces',
      });
      expect(url).toBe('http://traces-host:4318/prefix');
    });
  });
});
