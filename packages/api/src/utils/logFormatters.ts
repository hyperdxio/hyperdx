// Keep numeric `level` (the HyperDX OTLP transport maps PINO_LEVELS[level]) and
// add a string `severity`, which the OTel collector needs to classify severity
// from stdout-scraped logs instead of guessing from the body.
export const pinoLevelFormatter = (
  label: string,
  level: number,
): { level: number; severity: string } => ({ level, severity: label });
