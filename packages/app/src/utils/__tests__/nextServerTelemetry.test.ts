import {
  getNextServerServiceName,
  isStaticAssetRequest,
  startNextServerTelemetry,
} from '@/utils/nextServerTelemetry';

const mockInit = jest.fn();
let mockExporterEnabled = true;
let mockBasePath = '';

jest.mock('@clickhouse/clickstack-node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
}));
jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  get HDX_EXPORTER_ENABLED() {
    return mockExporterEnabled;
  },
  get BASE_PATH() {
    return mockBasePath;
  },
}));

describe('getNextServerServiceName', () => {
  it('suffixes OTEL_SERVICE_NAME', () => {
    expect(
      getNextServerServiceName({
        OTEL_SERVICE_NAME: 'hdx-oss-dev-app',
        OTEL_RESOURCE_ATTRIBUTES: 'service.name=other',
      }),
    ).toBe('hdx-oss-dev-app-next');
  });

  it('falls back to service.name in OTEL_RESOURCE_ATTRIBUTES', () => {
    expect(
      getNextServerServiceName({
        OTEL_SERVICE_NAME: ' ',
        OTEL_RESOURCE_ATTRIBUTES: 'service.version=1, service.name = my%20app',
      }),
    ).toBe('my app-next');
  });

  it('falls back to hdx-oss-app', () => {
    expect(
      getNextServerServiceName({
        OTEL_RESOURCE_ATTRIBUTES: 'service.version=1',
      }),
    ).toBe('hdx-oss-app-next');
  });

  // The SDK drops the whole variable for any of these, so the API would not
  // report the name either
  it.each([
    ['a value it cannot decode', 'service.name=%E0'],
    ['an unencoded =', 'service.name=acme,k8s.pod.labels=app=web'],
    ['an entry without =', 'service.name=acme,region'],
    ['an empty key', 'service.name=acme,=web'],
    ['a value over 255 characters', `service.name=acme,t=${'a'.repeat(256)}`],
  ])('ignores OTEL_RESOURCE_ATTRIBUTES with %s', (_case, attributes) => {
    expect(
      getNextServerServiceName({ OTEL_RESOURCE_ATTRIBUTES: attributes }),
    ).toBe('hdx-oss-app-next');
  });

  it('suffixes a name that already ends in -next', () => {
    expect(
      getNextServerServiceName({ OTEL_SERVICE_NAME: 'hyperdx-next' }),
    ).toBe('hyperdx-next-next');
  });
});

describe('isStaticAssetRequest', () => {
  it.each([
    '/_next/static/chunks/main.js',
    '/_next/static/css/app.css?v=1',
    '/_next/webpack-hmr?id=1',
    '/__nextjs_original-stack-frames',
    '/__ENV.js',
    '/whats-new.json',
    '/favicons/clickstack/favicon.svg',
    '/pyodide/pyodide.js',
    '/pyodide/pyodide.asm.wasm',
    '/drain3-0.9.11-py3-none-any.whl',
  ])('skips %s', url => {
    expect(isStaticAssetRequest(url, '')).toBe(true);
  });

  it.each([
    '/api/me',
    '/search',
    '/_next/data/build/search.json',
    '/__ENV.js.map',
    undefined,
  ])('keeps %s', url => {
    expect(isStaticAssetRequest(url, '')).toBe(false);
  });

  it('matches below the base path', () => {
    expect(isStaticAssetRequest('/hdx/_next/static/a.js', '/hdx')).toBe(true);
    expect(isStaticAssetRequest('/hdx/__ENV.js', '/hdx')).toBe(true);
    expect(isStaticAssetRequest('/hdx/api/me', '/hdx')).toBe(false);
  });
});

describe('startNextServerTelemetry', () => {
  const originalEnv = { ...process.env };

  const start = async (env: Record<string, string>) => {
    for (const key of [
      'HYPERDX_API_KEY',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'OTEL_SERVICE_NAME',
      'OTEL_RESOURCE_ATTRIBUTES',
      'OTEL_LOG_LEVEL',
    ]) {
      delete process.env[key];
    }
    Object.assign(process.env, env);
    await startNextServerTelemetry();
  };

  // The hook reads only the URL of the IncomingMessage it gets
  const ignoreHook = (): ((request: { url?: string }) => boolean) =>
    mockInit.mock.calls[0][0].instrumentations[
      '@opentelemetry/instrumentation-http'
    ].ignoreIncomingRequestHook;

  beforeEach(() => {
    mockInit.mockClear();
    mockExporterEnabled = true;
    mockBasePath = '';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not start without a key or OTLP headers', async () => {
    await start({ OTEL_SERVICE_NAME: 'hdx-app' });

    expect(mockInit).not.toHaveBeenCalled();
    expect(process.env.OTEL_SERVICE_NAME).toBe('hdx-app');
  });

  it('does not start when HDX_EXPORTER_ENABLED is false', async () => {
    mockExporterEnabled = false;

    await start({ HYPERDX_API_KEY: 'ingest-key' });

    expect(mockInit).not.toHaveBeenCalled();
  });

  it('starts with its own service name and a quieter diag level', async () => {
    await start({
      HYPERDX_API_KEY: 'ingest-key',
      OTEL_SERVICE_NAME: 'hdx-app',
    });

    expect(mockInit).toHaveBeenCalledWith({
      apiKey: 'ingest-key',
      instrumentations: {
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: expect.any(Function),
        },
      },
    });
    expect(process.env.OTEL_SERVICE_NAME).toBe('hdx-app-next');
    expect(process.env.OTEL_LOG_LEVEL).toBe('error');
  });

  it("keeps the operator's OTEL_LOG_LEVEL", async () => {
    await start({ HYPERDX_API_KEY: 'ingest-key', OTEL_LOG_LEVEL: 'debug' });

    expect(process.env.OTEL_LOG_LEVEL).toBe('debug');
  });

  it('appends the key to OTLP headers that have no authorization entry', async () => {
    await start({
      HYPERDX_API_KEY: 'ingest-key',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-scope-orgid=acme',
    });

    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
      'x-scope-orgid=acme,authorization=ingest-key',
    );
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it('skips static asset requests below the base path', async () => {
    mockBasePath = '/hdx';

    await start({ HYPERDX_API_KEY: 'ingest-key' });

    const hook = ignoreHook();
    expect(hook({ url: '/hdx/_next/static/a.js' })).toBe(true);
    expect(hook({ url: '/hdx/api/me' })).toBe(false);
  });
});
