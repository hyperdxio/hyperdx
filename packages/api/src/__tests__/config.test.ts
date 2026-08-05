describe('config', () => {
  describe('FRONTEND_REDIRECT_BASE', () => {
    const ORIGINAL_INLINE = process.env.HDX_PREVIEW_INLINE_API;
    const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

    afterEach(() => {
      // Restore the original env vars so other tests in the suite see the
      // values they expect.
      if (ORIGINAL_INLINE === undefined) {
        delete process.env.HDX_PREVIEW_INLINE_API;
      } else {
        process.env.HDX_PREVIEW_INLINE_API = ORIGINAL_INLINE;
      }
      if (ORIGINAL_FRONTEND_URL === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
      }
      jest.resetModules();
    });

    it('falls back to FRONTEND_URL when HDX_PREVIEW_INLINE_API is not set', () => {
      delete process.env.HDX_PREVIEW_INLINE_API;
      process.env.FRONTEND_URL = 'https://hyperdx.io';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        const config = require('@/config');
        expect(config.IS_INLINE_API).toBe(false);
        expect(config.FRONTEND_REDIRECT_BASE).toBe('https://hyperdx.io');
        expect(config.FRONTEND_REDIRECT_BASE).toBe(config.FRONTEND_URL);
      });
    });

    it('falls back to FRONTEND_URL when HDX_PREVIEW_INLINE_API is "false"', () => {
      process.env.HDX_PREVIEW_INLINE_API = 'false';
      process.env.FRONTEND_URL = 'https://hyperdx.io';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        const config = require('@/config');
        expect(config.IS_INLINE_API).toBe(false);
        expect(config.FRONTEND_REDIRECT_BASE).toBe('https://hyperdx.io');
      });
    });

    it('emits an empty string (relative redirects) when HDX_PREVIEW_INLINE_API is "true"', () => {
      process.env.HDX_PREVIEW_INLINE_API = 'true';
      process.env.FRONTEND_URL = 'https://private.hyperdx.io';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        const config = require('@/config');
        expect(config.IS_INLINE_API).toBe(true);
        expect(config.FRONTEND_REDIRECT_BASE).toBe('');
        // Sanity check: FRONTEND_URL itself is unchanged so emails/SAML
        // callbacks still have the absolute origin available when needed.
        expect(config.FRONTEND_URL).toBe('https://private.hyperdx.io');
      });
    });
  });

  describe('SPAN_METRICS_PROM_RW_ENDPOINT', () => {
    const ORIGINAL = process.env.SPAN_METRICS_PROM_RW_ENDPOINT;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.SPAN_METRICS_PROM_RW_ENDPOINT;
      } else {
        process.env.SPAN_METRICS_PROM_RW_ENDPOINT = ORIGINAL;
      }
      jest.resetModules();
    });

    const resolve = (raw: string | undefined) => {
      if (raw === undefined) {
        delete process.env.SPAN_METRICS_PROM_RW_ENDPOINT;
      } else {
        process.env.SPAN_METRICS_PROM_RW_ENDPOINT = raw;
      }
      let resolved: string | undefined;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        resolved = require('@/config').SPAN_METRICS_PROM_RW_ENDPOINT;
      });
      return resolved;
    };

    it('accepts a plain http or https endpoint', () => {
      expect(resolve('http://prometheus:9090/api/v1/write')).toBe(
        'http://prometheus:9090/api/v1/write',
      );
      expect(resolve('https://prom.example.com/api/v1/push')).toBe(
        'https://prom.example.com/api/v1/push',
      );
    });

    // The generated collector config is served from the unauthenticated OpAMP
    // endpoint, so a credential in this URL is readable by anyone who can POST
    // there. Pointing at a hosted Prometheus this way is the common case, which
    // is why it is rejected rather than passed along.
    it('rejects an endpoint carrying credentials', () => {
      expect(resolve('https://user:token@prom.example.com/api/v1/push')).toBe(
        undefined,
      );
      expect(resolve('https://token@prom.example.com/api/v1/push')).toBe(
        undefined,
      );
    });

    it('rejects a non-HTTP scheme or an unparseable URL', () => {
      expect(resolve('file:///etc/passwd')).toBe(undefined);
      expect(resolve('prometheus:9090')).toBe(undefined);
      expect(resolve('not a url')).toBe(undefined);
    });

    it('is undefined when unset', () => {
      expect(resolve(undefined)).toBe(undefined);
    });
  });
});
