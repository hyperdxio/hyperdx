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

  describe('EXPRESS_SESSION_SECRET', () => {
    const ORIGINAL_SECRET = process.env.EXPRESS_SESSION_SECRET;

    afterEach(() => {
      if (ORIGINAL_SECRET === undefined) {
        delete process.env.EXPRESS_SESSION_SECRET;
      } else {
        process.env.EXPRESS_SESSION_SECRET = ORIGINAL_SECRET;
      }
      jest.resetModules();
    });

    // The `jest` object's isolateModules returns `jest` itself rather than the
    // callback's value, so the module has to be captured from inside it.
    const loadConfig = () => {
      let loaded!: typeof import('@/config');
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        loaded = require('@/config');
      });
      return loaded;
    };

    it('uses a configured secret verbatim', () => {
      process.env.EXPRESS_SESSION_SECRET = 'a-deployment-specific-secret';

      const config = loadConfig();
      expect(config.EXPRESS_SESSION_SECRET).toBe(
        'a-deployment-specific-secret',
      );
      expect(config.IS_EXPRESS_SESSION_SECRET_GENERATED).toBe(false);
    });

    it('generates a secret when unset or empty', () => {
      for (const value of [undefined, '']) {
        if (value === undefined) {
          delete process.env.EXPRESS_SESSION_SECRET;
        } else {
          process.env.EXPRESS_SESSION_SECRET = value;
        }

        const config = loadConfig();
        expect(config.EXPRESS_SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
        expect(config.IS_EXPRESS_SESSION_SECRET_GENERATED).toBe(true);
      }
    });

    it('generates a different secret on each load', () => {
      delete process.env.EXPRESS_SESSION_SECRET;

      expect(loadConfig().EXPRESS_SESSION_SECRET).not.toBe(
        loadConfig().EXPRESS_SESSION_SECRET,
      );
    });
  });
});
