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
        // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
        enabled = require('@/config').DIAGNOSTICS_ENABLED;
      });
      return enabled;
    };

    it('is on by default', () => {
      expect(enabledWith({})).toBe(true);
    });

    it('is off by default in local app mode, where auth is skipped', () => {
      expect(enabledWith({ local: true })).toBe(false);
    });

    it('follows an explicit setting either way', () => {
      expect(enabledWith({ local: true, flag: 'true' })).toBe(true);
      expect(enabledWith({ flag: 'false' })).toBe(false);
    });
  });
});
