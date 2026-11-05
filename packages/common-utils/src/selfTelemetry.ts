/**
 * Shared by the API's self-telemetry preload and the Next.js server
 * instrumentation, which both wrap the ClickStack SDK's init().
 *
 * It has no imports so the API preload can load it before init() without
 * loading anything the SDK would then fail to instrument.
 */

/**
 * The variables the decision reads. The index signature lets `process.env`
 * through TypeScript's check for objects that share no named property.
 */
export type SelfTelemetryEnv = {
  HYPERDX_API_KEY?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  [name: string]: string | undefined;
};

export type SelfTelemetryDecision =
  | { start: false }
  | {
      start: true;
      /** The init() apiKey option. Unset when the key went into otlpHeaders. */
      apiKey: string | undefined;
      /**
       * The OTEL_EXPORTER_OTLP_HEADERS value to write before init(), when the
       * key had to be appended to it. Unset when the variable stays as it is.
       */
      otlpHeaders: string | undefined;
    };

const hasAuthorization = (headers: string) =>
  headers
    .split(',')
    .some(
      entry => entry.split('=')[0].trim().toLowerCase() === 'authorization',
    );

export function decideSelfTelemetry(
  env: SelfTelemetryEnv,
): SelfTelemetryDecision {
  const apiKey = env.HYPERDX_API_KEY?.trim() || undefined;
  const otlpHeaders = env.OTEL_EXPORTER_OTLP_HEADERS?.trim() || undefined;

  // The old HyperDX SDK skipped init without a key or OTLP headers, and the
  // ClickStack SDK always starts. Without this gate, deployments that never
  // exported HyperDX's own telemetry would start sending it to localhost:4318,
  // which is the bundled collector in the all-in-one image.
  if (!apiKey && !otlpHeaders) {
    return { start: false };
  }

  // The SDK ignores apiKey when OTEL_EXPORTER_OTLP_HEADERS is set. The old SDK
  // appended the key to those headers, so do the same unless they already
  // carry one, in which case the SDK warns that the key is ignored.
  if (apiKey && otlpHeaders && !hasAuthorization(otlpHeaders)) {
    return {
      start: true,
      apiKey: undefined,
      otlpHeaders: `${otlpHeaders},authorization=${encodeURIComponent(apiKey)}`,
    };
  }

  return { start: true, apiKey, otlpHeaders: undefined };
}
