import { decideSelfTelemetry } from '@/selfTelemetry';

describe('decideSelfTelemetry', () => {
  it('does not start without a key or OTLP headers', () => {
    expect(decideSelfTelemetry({})).toEqual({ start: false });
  });

  it('treats blank values as unset', () => {
    expect(
      decideSelfTelemetry({
        HYPERDX_API_KEY: ' ',
        OTEL_EXPORTER_OTLP_HEADERS: '',
      }),
    ).toEqual({ start: false });
  });

  it('passes a trimmed HYPERDX_API_KEY as the apiKey', () => {
    expect(decideSelfTelemetry({ HYPERDX_API_KEY: ' ingest-key ' })).toEqual({
      start: true,
      apiKey: 'ingest-key',
      otlpHeaders: undefined,
    });
  });

  it('starts on OTLP headers alone and leaves them as they are', () => {
    expect(
      decideSelfTelemetry({
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=ingest-key',
      }),
    ).toEqual({ start: true, apiKey: undefined, otlpHeaders: undefined });
  });

  it('appends the encoded key to OTLP headers without an authorization entry', () => {
    expect(
      decideSelfTelemetry({
        HYPERDX_API_KEY: 'ingest,key',
        OTEL_EXPORTER_OTLP_HEADERS: ' x-scope-orgid=acme ',
      }),
    ).toEqual({
      start: true,
      apiKey: undefined,
      otlpHeaders: 'x-scope-orgid=acme,authorization=ingest%2Ckey',
    });
  });

  it('keeps an authorization entry already in the OTLP headers', () => {
    expect(
      decideSelfTelemetry({
        HYPERDX_API_KEY: 'ingest-key',
        OTEL_EXPORTER_OTLP_HEADERS: 'x-scope-orgid=acme, Authorization =other',
      }),
    ).toEqual({ start: true, apiKey: 'ingest-key', otlpHeaders: undefined });
  });
});
