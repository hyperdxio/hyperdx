/**
 * Pino `level` formatter used by the application logger.
 *
 * Pino serializes `level` as a number by default (10=trace … 60=fatal). Two
 * downstream consumers read it differently:
 *
 *  - The HyperDX OTLP transport (`@hyperdx/node-opentelemetry`) maps the
 *    NUMERIC level via `PINO_LEVELS[level]`, so `level` must stay a number.
 *  - The OTel collector that tails container stdout can only promote a log's
 *    severity from a STRING field (`level`/`severity`/...). A numeric level is
 *    ignored, which forces the collector into a body-keyword fallback that
 *    mis-classifies logs (e.g. anything containing the word "alert" becomes
 *    FATAL).
 *
 * Emitting both keeps the OTLP path working while giving the collector a string
 * `severity` it can promote, so structured logs are classified correctly.
 */
export const pinoLevelFormatter = (
  label: string,
  level: number,
): { level: number; severity: string } => ({ level, severity: label });
