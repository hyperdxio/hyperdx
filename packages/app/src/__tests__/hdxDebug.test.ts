// hdxDebug reads config constants at module-load, so each config permutation is
// exercised by resetting modules and re-requiring with a fresh @/config mock.

const baseConfig = {
  APP_VERSION: '9.9.9',
  BASE_PATH: '',
  IS_ALERT_DETAILS_ENABLED: false,
  IS_CLICKHOUSE_BUILD: false,
  IS_LLM_COST_ENABLED: false,
  IS_DEV: false,
  IS_LOCAL_MODE: false,
  IS_OSS: true as unknown,
  IS_PROMQL_ENABLED: false,
};

function loadHdxDebug(configOverrides: Partial<typeof baseConfig> = {}) {
  jest.resetModules();
  jest.doMock('@/config', () => ({ ...baseConfig, ...configOverrides }));
  jest.doMock('@hyperdx/browser', () => ({
    __esModule: true,
    default: { getSessionId: () => undefined },
  }));
  jest.doMock('@/utils/clipboard', () => ({
    copyTextToClipboard: jest.fn().mockResolvedValue(true),
  }));
  return jest.requireActual<typeof import('@/hdxDebug')>('@/hdxDebug');
}

// Render the report through the public surface: install window.hdx, then read
// what report() produces. Keeps buildReport/safeUrl internal.
function reportFor(
  mod: typeof import('@/hdxDebug'),
  identity?: Parameters<typeof mod.setHdxIdentity>[0],
): string {
  if (identity) mod.setHdxIdentity(identity);
  mod.installHdxDebug();
  if (!window.hdx) throw new Error('window.hdx was not installed');
  return window.hdx.report();
}

afterEach(() => {
  delete window.hdx;
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('fetchServerVersion', () => {
  const realFetch = global.fetch;

  // A minimal fetch stub — fetchServerVersion only reads res.ok and res.json().
  function setFetch(fn: (...args: any[]) => Promise<any>) {
    global.fetch = fn as typeof global.fetch;
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns undefined in local mode without fetching', async () => {
    const fetchSpy = jest.fn(() => Promise.resolve({ ok: true }));
    setFetch(fetchSpy);
    const { fetchServerVersion } = loadHdxDebug({ IS_LOCAL_MODE: true });

    await expect(fetchServerVersion()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns undefined on a non-ok response', async () => {
    setFetch(() => Promise.resolve({ ok: false }));
    const { fetchServerVersion } = loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns undefined when the body is not JSON', async () => {
    setFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error('not json')),
      }),
    );
    const { fetchServerVersion } = loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns undefined when fetch throws', async () => {
    setFetch(() => Promise.reject(new Error('network')));
    const { fetchServerVersion } = loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns undefined when the payload lacks a version', async () => {
    setFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'OK' }),
      }),
    );
    const { fetchServerVersion } = loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns the parsed version on success and feeds it into the report', async () => {
    setFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.1-sha0724861' }),
      }),
    );
    const mod = loadHdxDebug();

    await expect(mod.fetchServerVersion()).resolves.toBe('2.0.1-sha0724861');
    expect(reportFor(mod)).toContain('backend:  2.0.1-sha0724861');
  });
});

describe('report mode line', () => {
  it('reports oss when IS_OSS is true', () => {
    expect(reportFor(loadHdxDebug({ IS_OSS: true }))).toContain(
      'mode:     oss',
    );
  });

  it('reports cloud when NEXT_PUBLIC_IS_OSS resolves to the string "false"', () => {
    // Mirrors config.ts's IS_OSS precedence quirk, where a disabled deployment
    // surfaces the truthy string "false".
    expect(reportFor(loadHdxDebug({ IS_OSS: 'false' }))).toContain(
      'mode:     cloud',
    );
  });

  it('reports local when in local mode', () => {
    expect(reportFor(loadHdxDebug({ IS_LOCAL_MODE: true }))).toContain(
      'mode:     local',
    );
  });

  it('appends the clickstack suffix for ClickHouse builds', () => {
    expect(reportFor(loadHdxDebug({ IS_CLICKHOUSE_BUILD: true }))).toContain(
      'mode:     oss (clickstack)',
    );
  });
});

describe('report identity + features', () => {
  it('omits user/team lines until identity is set', () => {
    const report = reportFor(loadHdxDebug());
    expect(report).not.toContain('user:');
    expect(report).not.toContain('team:');
  });

  it('includes user/team lines once identity is set', () => {
    const report = reportFor(loadHdxDebug(), { userId: 'u1', teamId: 't1' });
    expect(report).toContain('user:     u1');
    expect(report).toContain('team:     t1');
  });

  it('lists only enabled features and dynamic toggles', () => {
    const report = reportFor(loadHdxDebug({ IS_PROMQL_ENABLED: true }), {
      features: { aiAssistant: true, usageStats: false },
    });
    expect(report).toContain('features: promql, aiAssistant');
    expect(report).not.toContain('usageStats');
  });

  it('reports "none" when no feature is enabled', () => {
    expect(reportFor(loadHdxDebug())).toContain('features: none');
  });
});

describe('report url line', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  // jsdom won't let us redefine window.location, but history.replaceState
  // updates location.pathname/search.
  function setLocation(pathname: string, search: string) {
    window.history.replaceState(null, '', `${pathname}${search}`);
  }

  it('reports the pathname without the query string', () => {
    setLocation('/search', '?source=abc&from=1');
    expect(reportFor(loadHdxDebug())).toContain('url:      /search');
  });

  it('drops query params, so tokens never reach the report', () => {
    setLocation('/join-team', '?token=super-secret');
    const report = reportFor(loadHdxDebug());
    expect(report).toContain('url:      /join-team');
    expect(report).not.toContain('super-secret');
    expect(report).not.toContain('token');
  });
});

describe('report session and recent errors', () => {
  it('says the session is not recording when there is no session id', () => {
    expect(reportFor(loadHdxDebug())).toContain('session:  not recording');
  });

  it('reports no recent errors when none were recorded', () => {
    expect(reportFor(loadHdxDebug())).toContain('recent errors: none');
  });

  it('lists recorded errors with their status or code', () => {
    const mod = loadHdxDebug();
    // Same module registry as hdxDebug after loadHdxDebug's resetModules.
    const { recordRecentError } =
      jest.requireActual<typeof import('@/recentErrors')>('@/recentErrors');
    recordRecentError(
      Object.assign(new Error('Bad gateway'), {
        name: 'HTTPError',
        response: { status: 502 },
      }),
    );
    recordRecentError(new Error('Code: 60. DB::Exception: missing table'));

    const report = reportFor(mod);
    expect(report).toContain('recent errors:');
    expect(report).toMatch(/\/ HTTPError \[502\] Bad gateway/);
    expect(report).toMatch(/\/ Error \[CH 60\] Code: 60\. DB::Exception/);
  });

  it('shows the failing endpoint and how often the failure repeated', () => {
    const mod = loadHdxDebug();
    const { recordRecentError } =
      jest.requireActual<typeof import('@/recentErrors')>('@/recentErrors');
    const err = () =>
      Object.assign(new Error('Request failed with status code 502'), {
        name: 'HTTPError',
        request: { method: 'GET', url: 'http://localhost/api/dashboards' },
        response: { status: 502 },
      });
    recordRecentError(err());
    recordRecentError(err());

    expect(reportFor(mod)).toMatch(
      /HTTPError \[502\] GET \/api\/dashboards Request failed with status code 502 \(x2\)/,
    );
  });

  it("prints the API's reason instead of ky's status message", async () => {
    const mod = loadHdxDebug();
    const { recordRecentError } =
      jest.requireActual<typeof import('@/recentErrors')>('@/recentErrors');
    recordRecentError(
      Object.assign(new Error('Request failed with status code 404'), {
        name: 'HTTPError',
        request: { method: 'GET', url: 'http://localhost/api/sources/1' },
        response: {
          status: 404,
          clone: () => ({
            json: async () => ({ message: 'Source not found' }),
          }),
        },
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    const report = reportFor(mod);
    expect(report).toContain('GET /api/sources/1 Source not found');
    expect(report).not.toContain('Request failed with status code 404');
  });
});
