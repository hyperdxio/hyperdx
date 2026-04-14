describe('@hyperdx/node-opentelemetry per-signal endpoint support', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should use OTEL_EXPORTER_OTLP_TRACES_ENDPOINT over base endpoint', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4318';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
      'http://traces-collector:4318/v1/traces';

    const constants = await import(
      '@hyperdx/node-opentelemetry/build/src/constants'
    );
    expect(constants.DEFAULT_OTEL_TRACES_EXPORTER_URL).toBe(
      'http://traces-collector:4318/v1/traces',
    );
  });

  it('should use OTEL_EXPORTER_OTLP_LOGS_ENDPOINT over base endpoint', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4318';
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT =
      'http://logs-collector:4318/v1/logs';

    const constants = await import(
      '@hyperdx/node-opentelemetry/build/src/constants'
    );
    expect(constants.DEFAULT_OTEL_LOGS_EXPORTER_URL).toBe(
      'http://logs-collector:4318/v1/logs',
    );
  });

  it('should use OTEL_EXPORTER_OTLP_METRICS_ENDPOINT over base endpoint', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4318';
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT =
      'http://metrics-collector:4318/v1/metrics';

    const constants = await import(
      '@hyperdx/node-opentelemetry/build/src/constants'
    );
    expect(constants.DEFAULT_OTEL_METRICS_EXPORTER_URL).toBe(
      'http://metrics-collector:4318/v1/metrics',
    );
  });

  it('should derive signal URLs from base endpoint when per-signal vars are not set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4318';
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;

    const constants = await import(
      '@hyperdx/node-opentelemetry/build/src/constants'
    );
    expect(constants.DEFAULT_OTEL_TRACES_EXPORTER_URL).toBe(
      'http://base-collector:4318/v1/traces',
    );
    expect(constants.DEFAULT_OTEL_LOGS_EXPORTER_URL).toBe(
      'http://base-collector:4318/v1/logs',
    );
    expect(constants.DEFAULT_OTEL_METRICS_EXPORTER_URL).toBe(
      'http://base-collector:4318/v1/metrics',
    );
  });

  it('should allow mixing per-signal and base endpoints', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4318';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
      'http://dedicated-traces:4318/v1/traces';
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;

    const constants = await import(
      '@hyperdx/node-opentelemetry/build/src/constants'
    );
    expect(constants.DEFAULT_OTEL_TRACES_EXPORTER_URL).toBe(
      'http://dedicated-traces:4318/v1/traces',
    );
    expect(constants.DEFAULT_OTEL_LOGS_EXPORTER_URL).toBe(
      'http://base-collector:4318/v1/logs',
    );
    expect(constants.DEFAULT_OTEL_METRICS_EXPORTER_URL).toBe(
      'http://base-collector:4318/v1/metrics',
    );
  });

  it('should use base endpoint as-is for gRPC protocol (no path suffix)', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://base-collector:4317';
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;

    const constants = await import(
      '@hyperdx/node-opentelemetry/build/src/constants'
    );
    expect(constants.DEFAULT_OTEL_TRACES_EXPORTER_URL).toBe(
      'http://base-collector:4317',
    );
    expect(constants.DEFAULT_OTEL_LOGS_EXPORTER_URL).toBe(
      'http://base-collector:4317',
    );
  });
});
