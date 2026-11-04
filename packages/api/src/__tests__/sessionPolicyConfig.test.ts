describe('session policy configuration', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    delete process.env.SESSION_MAX_AGE_SECONDS;
    delete process.env.SESSION_IDLE_TIMEOUT_SECONDS;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  const readConfig = () =>
    jest.requireActual<typeof import('@/config')>('@/config');

  it('retains legacy defaults when no policy is configured', () => {
    expect(readConfig().SESSION_MAX_AGE_SECONDS).toBeUndefined();
    expect(readConfig().SESSION_IDLE_TIMEOUT_SECONDS).toBe(2592000);
  });

  it.each(['', '0', '-1', '1.5', 'NaN', 'Infinity', '2592001'])(
    'rejects an invalid session limit (%s)',
    value => {
      process.env.SESSION_MAX_AGE_SECONDS = value;
      expect(readConfig).toThrow(/SESSION/);
      delete process.env.SESSION_MAX_AGE_SECONDS;
      process.env.SESSION_IDLE_TIMEOUT_SECONDS = value;
      expect(readConfig).toThrow(/SESSION/);
    },
  );

  it('rejects an idle period longer than the absolute lifetime', () => {
    process.env.SESSION_MAX_AGE_SECONDS = '86400';
    process.env.SESSION_IDLE_TIMEOUT_SECONDS = '86401';
    expect(readConfig).toThrow(/must not exceed/);
  });
});
