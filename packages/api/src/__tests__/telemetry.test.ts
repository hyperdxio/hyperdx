const mockInit = jest.fn();
let mockIsMainThread = true;

jest.mock('@clickhouse/clickstack-node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
}));
jest.mock('node:worker_threads', () => ({
  get isMainThread() {
    return mockIsMainThread;
  },
}));

describe('telemetry preload', () => {
  const originalEnv = { ...process.env };

  const runPreload = (env: Record<string, string>) => {
    delete process.env.HYPERDX_API_KEY;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.NODE_ENV;
    Object.assign(process.env, env);
    jest.isolateModules(() => {
      jest.requireActual('@/telemetry');
    });
  };

  beforeEach(() => {
    mockInit.mockClear();
    mockIsMainThread = true;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not start the SDK without a key or OTLP headers', () => {
    runPreload({ HYPERDX_API_KEY: ' ', OTEL_EXPORTER_OTLP_HEADERS: '' });

    expect(mockInit).not.toHaveBeenCalled();
  });

  it('passes HYPERDX_API_KEY as the apiKey', () => {
    runPreload({ HYPERDX_API_KEY: 'ingest-key', NODE_ENV: 'production' });

    expect(mockInit).toHaveBeenCalledWith({
      apiKey: 'ingest-key',
      instrumentations: undefined,
    });
  });

  it('appends the key to OTLP headers that have no authorization entry', () => {
    runPreload({
      HYPERDX_API_KEY: 'ingest,key',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-scope-orgid=acme',
    });

    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
      'x-scope-orgid=acme,authorization=ingest%2Ckey',
    );
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it('enables host metrics only in development', () => {
    runPreload({ HYPERDX_API_KEY: 'ingest-key', NODE_ENV: 'development' });

    expect(mockInit).toHaveBeenCalledWith({
      apiKey: 'ingest-key',
      instrumentations: {
        '@opentelemetry/instrumentation-host-metrics': { enabled: true },
      },
    });
  });

  it('does not start a second SDK in a worker thread', () => {
    mockIsMainThread = false;

    runPreload({ HYPERDX_API_KEY: 'ingest-key' });

    expect(mockInit).not.toHaveBeenCalled();
  });
});
