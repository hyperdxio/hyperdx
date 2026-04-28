// Subject: log pattern (templatized message + occurrence count + samples)
import {
  Pattern,
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
} from '@/hooks/usePatterns';

import { attrToString } from './formatHelpers';
import { SummarySubject } from './subjects';

export interface PatternSubjectInput {
  pattern: Pattern;
  serviceNameExpression: string;
}

const SKIP_KEYS = new Set([
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
  '__hdx_pk',
  'SortKey',
]);

// Per-attribute cap; 200 chars is enough for URLs, status codes, short
// messages — anything longer is likely redacted body content.
const coerceAttr = (v: unknown) => attrToString(v, 200);

export function formatPatternContent({
  pattern,
  serviceNameExpression,
}: PatternSubjectInput): string {
  const parts: string[] = [];

  parts.push(`Pattern: ${pattern.pattern}`);
  parts.push(`Occurrences: ${pattern.count}`);

  const samplesSlice = pattern.samples.slice(0, 5);
  if (samplesSlice.length > 0) {
    parts.push('Sample events:');
    for (const sample of samplesSlice) {
      const body = sample[PATTERN_COLUMN_ALIAS] ?? '';
      const svc = sample[serviceNameExpression] ?? '';
      const sev = sample[SEVERITY_TEXT_COLUMN_ALIAS] ?? '';
      parts.push(`  - [${sev}] ${svc}: ${body}`);

      // Include interesting attributes from the first sample only (token budget)
      if (sample === samplesSlice[0]) {
        const attrs = Object.entries(sample)
          .filter(
            ([k, v]) =>
              v != null &&
              v !== '' &&
              !SKIP_KEYS.has(k) &&
              !k.startsWith('__hdx_') &&
              k !== serviceNameExpression,
          )
          .slice(0, 15);
        if (attrs.length > 0) {
          parts.push(
            `    Attributes: ${attrs.map(([k, v]) => `${k}=${coerceAttr(v)}`).join(', ')}`,
          );
        }
      }
    }
  }

  return parts.join('\n');
}

export const PATTERN_SUBJECT: SummarySubject<PatternSubjectInput> = {
  kind: 'pattern',
  analyzingLabel: 'Analyzing pattern data...',
  formatContent: formatPatternContent,
};
