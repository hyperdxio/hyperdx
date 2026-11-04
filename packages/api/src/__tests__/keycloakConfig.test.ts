describe('Keycloak configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('KEYCLOAK_')) delete process.env[key];
    }
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://hyperdx.example.com';
    delete process.env.IS_LOCAL_APP_MODE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const readConfig = () =>
    jest.requireActual<typeof import('@/config')>('@/config');

  it('leaves Keycloak disabled without configuration', () => {
    expect(readConfig().KEYCLOAK).toBeUndefined();
    expect(readConfig().KEYCLOAK_REQUIRED).toBe(false);
  });

  it('derives the callback from the public frontend URL', () => {
    process.env.KEYCLOAK_ISSUER = 'https://identity.example.com/realms/hyperdx';
    process.env.KEYCLOAK_CLIENT_ID = 'hyperdx';
    expect(readConfig().KEYCLOAK).toMatchObject({
      issuer: 'https://identity.example.com/realms/hyperdx',
      clientId: 'hyperdx',
      callbackUrl: 'https://hyperdx.example.com/api/login/keycloak/callback',
    });
  });

  it.each([
    { KEYCLOAK_REQUIRED: 'true' },
    { KEYCLOAK_REQUIRED: 'tru' },
    { KEYCLOAK_ISSUER: 'https://id.example.com/realms/test' },
    { KEYCLOAK_CLIENT_SECRET: 'secret-sentinel' },
    {
      KEYCLOAK_ISSUER: 'http://id.example.com/realms/test',
      KEYCLOAK_CLIENT_ID: 'hdx',
    },
    {
      KEYCLOAK_ISSUER: 'https://id.example.com/realms/test?x=1',
      KEYCLOAK_CLIENT_ID: 'hdx',
    },
    {
      KEYCLOAK_ISSUER: 'https://id.example.com/realms/test',
      KEYCLOAK_CLIENT_ID: 'hdx',
      FRONTEND_URL: 'http://hdx.example.com',
    },
    {
      KEYCLOAK_ISSUER: 'https://id.example.com/realms/test',
      KEYCLOAK_CLIENT_ID: 'hdx',
      FRONTEND_URL: '//hdx.example.com',
    },
    {
      KEYCLOAK_ISSUER: 'https://id.example.com/realms/test',
      KEYCLOAK_CLIENT_ID: 'hdx',
      IS_LOCAL_APP_MODE: 'DANGEROUSLY_is_local_app_mode💀',
    },
  ])('rejects incomplete or unsafe settings (%j)', settings => {
    Object.assign(process.env, settings);
    expect(readConfig).toThrow(/Keycloak/);
    try {
      readConfig();
    } catch (error) {
      expect(String(error)).not.toContain('secret-sentinel');
    }
  });
});
