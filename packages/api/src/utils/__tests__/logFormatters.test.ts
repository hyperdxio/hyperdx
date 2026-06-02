import pino from 'pino';

import { pinoLevelFormatter } from '../logFormatters';

describe('pinoLevelFormatter', () => {
  it('returns the numeric level alongside the string label', () => {
    expect(pinoLevelFormatter('trace', 10)).toEqual({
      level: 10,
      severity: 'trace',
    });
    expect(pinoLevelFormatter('info', 30)).toEqual({
      level: 30,
      severity: 'info',
    });
    expect(pinoLevelFormatter('error', 50)).toEqual({
      level: 50,
      severity: 'error',
    });
    expect(pinoLevelFormatter('fatal', 60)).toEqual({
      level: 60,
      severity: 'fatal',
    });
  });

  it('serializes both numeric level and string severity in pino output', () => {
    const lines: string[] = [];
    const stream: pino.DestinationStream = {
      write: (chunk: string) => {
        lines.push(chunk);
      },
    };

    const logger = pino(
      {
        base: null,
        timestamp: false,
        formatters: { level: pinoLevelFormatter },
      },
      stream,
    );

    logger.warn('hello');

    const parsed = JSON.parse(lines[0]);
    // Numeric level is preserved for the HyperDX OTLP transport.
    expect(parsed.level).toBe(40);
    // String severity is what the OTel collector promotes.
    expect(parsed.severity).toBe('warn');
  });
});
