import { Fragment } from 'react';

import styles from './PatternTemplate.module.scss';

export const PATTERN_WILDCARD = '<*>';

export type PatternTemplatePart =
  | { type: 'text'; value: string; at: number }
  | { type: 'slot'; at: number };

/** Split a Drain template so the UI can paint `<*>` as a hole, not more log text. */
export function splitPatternTemplate(text: string): PatternTemplatePart[] {
  if (!text.includes(PATTERN_WILDCARD)) {
    return text ? [{ type: 'text', value: text, at: 0 }] : [];
  }
  const parts: PatternTemplatePart[] = [];
  const chunks = text.split(PATTERN_WILDCARD);
  let at = 0;
  chunks.forEach((chunk, i) => {
    if (chunk) {
      parts.push({ type: 'text', value: chunk, at });
      at += chunk.length;
    }
    if (i < chunks.length - 1) {
      parts.push({ type: 'slot', at });
      at += PATTERN_WILDCARD.length;
    }
  });
  return parts;
}

/** Drain template with varying tokens drawn as holes, so the stable shape can be read. */
export function PatternTemplate({ text }: { text: string }) {
  const parts = splitPatternTemplate(text);
  if (parts.length === 0) {
    return null;
  }
  return (
    <span>
      {parts.map(part =>
        part.type === 'slot' ? (
          <span
            key={`slot-${part.at}`}
            className={styles.slot}
            title="Varied across events"
          >
            {PATTERN_WILDCARD}
          </span>
        ) : (
          <Fragment key={`text-${part.at}`}>{part.value}</Fragment>
        ),
      )}
    </span>
  );
}
