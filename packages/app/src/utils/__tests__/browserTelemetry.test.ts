import { trace } from '@opentelemetry/api';

import { getBrowserInitOptions, recordAction } from '@/utils/browserTelemetry';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('recordAction', () => {
  it('ends a span named after the action with its attributes', () => {
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('probe');
    const end = jest.spyOn(span, 'end');
    const startSpan = jest.spyOn(tracer, 'startSpan').mockReturnValue(span);
    const getTracer = jest.spyOn(trace, 'getTracer').mockReturnValue(tracer);

    recordAction('search executed', { latency_ms: 12, source_id: 's1' });

    expect(getTracer).toHaveBeenCalledWith('custom-action');
    expect(startSpan).toHaveBeenCalledWith('search executed', {
      attributes: { latency_ms: 12, source_id: 's1' },
    });
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('getBrowserInitOptions', () => {
  it('maps the app config onto the SDK options', () => {
    expect(
      getBrowserInitOptions({
        config: {
          apiKey: 'key',
          serviceName: 'hdx-app',
          collectorUrl: 'https://otel.example.com',
          collectorTracesUrl: 'https://traces.example.com/v1/traces',
          collectorLogsUrl: 'https://logs.example.com/v1/logs',
        },
        resourceAttributes:
          'deployment.environment.name=prod,team=core,service.version=9',
        serviceVersion: '2.0.0',
      }),
    ).toEqual({
      endpoint: 'https://otel.example.com',
      tracesEndpoint: 'https://traces.example.com/v1/traces',
      logsEndpoint: 'https://logs.example.com/v1/logs',
      apiKey: 'key',
      serviceName: 'hdx-app',
      serviceVersion: '2.0.0',
      resourceAttributes: {
        'deployment.environment.name': 'prod',
        team: 'core',
        'service.version': '9',
      },
      console: 'debug',
      maskAllText: true,
      maskAllInputs: true,
    });
  });

  it('leaves unset per-signal URLs and resource attributes empty', () => {
    const options = getBrowserInitOptions({
      config: { serviceName: 'hdx-app', collectorUrl: 'http://localhost:4318' },
      resourceAttributes: '',
      serviceVersion: undefined,
    });

    expect(options.tracesEndpoint).toBeUndefined();
    expect(options.logsEndpoint).toBeUndefined();
    expect(options.resourceAttributes).toEqual({});
  });
});
