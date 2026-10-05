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

  describe('EXTERNAL_API_RATE_LIMIT_MAX', () => {
    const ORIGINAL = process.env.EXTERNAL_API_RATE_LIMIT_MAX;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.EXTERNAL_API_RATE_LIMIT_MAX;
      } else {
        process.env.EXTERNAL_API_RATE_LIMIT_MAX = ORIGINAL;
      }
      jest.resetModules();
    });

    it('defaults to 100 when unset', () => {
      delete process.env.EXTERNAL_API_RATE_LIMIT_MAX;

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        const config = require('@/config');
        expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(100);
      });
    });

    it('accepts a valid positive integer', () => {
      process.env.EXTERNAL_API_RATE_LIMIT_MAX = '1000';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        const config = require('@/config');
        expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(1000);
      });
    });

    it('accepts exponential notation', () => {
      process.env.EXTERNAL_API_RATE_LIMIT_MAX = '1e3';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        const config = require('@/config');
        expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(1000);
      });
    });

    it.each([
      ['garbage string (NaN)', 'abc'],
      ['zero (express-rate-limit v6 treats 0 as unlimited)', '0'],
      ['negative', '-5'],
      ['trailing garbage', '100/min'],
      ['empty string', ''],
      ['fractional (would block every request at max=0.5)', '0.5'],
      ['Infinity (would disable the limit entirely)', 'Infinity'],
    ])(
      'falls back to the default of 100 and does not silently disable the limit: %s (%p)',
      (_desc, raw) => {
        process.env.EXTERNAL_API_RATE_LIMIT_MAX = raw;

        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
          const config = require('@/config');
          expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(100);
        });
      },
    );
  });

  describe('DIAGNOSTICS_ENABLED', () => {
    const ORIGINAL_ENV = { ...process.env };
    const LOCAL_APP_MODE = 'DANGEROUSLY_is_local_app_mode💀';

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
      jest.resetModules();
    });

    const enabledWith = (env: { local?: boolean; flag?: string }) => {
      delete process.env.IS_LOCAL_APP_MODE;
      delete process.env.HDX_DIAGNOSTICS_ENABLED;
      if (env.local) process.env.IS_LOCAL_APP_MODE = LOCAL_APP_MODE;
      if (env.flag) process.env.HDX_DIAGNOSTICS_ENABLED = env.flag;
      let enabled: boolean | undefined;
      jest.isolateModules(() => {
        enabled =
          jest.requireActual<typeof import('@/config')>(
            '@/config',
          ).DIAGNOSTICS_ENABLED;
      });
      return enabled;
    };

    it('is off by default', () => {
      expect(enabledWith({})).toBe(false);
      expect(enabledWith({ local: true })).toBe(false);
    });

    it('turns on only for true or 1', () => {
      expect(enabledWith({ flag: 'true' })).toBe(true);
      expect(enabledWith({ flag: 'TRUE' })).toBe(true);
      expect(enabledWith({ flag: '1' })).toBe(true);
      expect(enabledWith({ flag: 'false' })).toBe(false);
      // A typo must not turn on an endpoint the operator meant to leave off.
      expect(enabledWith({ flag: 'fales' })).toBe(false);
    });

    it('parses the heap snapshot flag the same way', () => {
      process.env.HDX_DIAGNOSTICS_HEAP_SNAPSHOT = '1';
      let enabled: boolean | undefined;
      jest.isolateModules(() => {
        enabled =
          jest.requireActual<typeof import('@/config')>(
            '@/config',
          ).DIAGNOSTICS_HEAP_SNAPSHOT_ENABLED;
      });
      expect(enabled).toBe(true);
    });
  });
});
