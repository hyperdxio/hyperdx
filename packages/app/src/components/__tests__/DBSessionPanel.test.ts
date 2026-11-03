import { pickSessionIdRow } from '@/components/DBSessionPanel';

describe('pickSessionIdRow', () => {
  it('prefers a legacy rum.sessionId row anywhere in the trace', () => {
    expect(
      pickSessionIdRow([
        { rumSessionId: '', otelSessionId: 'otel-1', serviceName: 'api' },
        { rumSessionId: 'rum-1', otelSessionId: '', serviceName: 'web' },
      ]),
    ).toEqual({
      rumSessionId: 'rum-1',
      rumServiceName: 'web',
      sessionIdKey: 'rum.sessionId',
    });
  });

  it('falls back to a browser session.id row', () => {
    expect(
      pickSessionIdRow([
        { rumSessionId: '', otelSessionId: '', serviceName: 'api' },
        { rumSessionId: '', otelSessionId: 'otel-1', serviceName: 'web' },
      ]),
    ).toEqual({
      rumSessionId: 'otel-1',
      rumServiceName: 'web',
      sessionIdKey: 'session.id',
    });
  });
});
