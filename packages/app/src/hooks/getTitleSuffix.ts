import { INSTANCE_LABEL } from '@/config';

// Collapsed defensively (not just relying on config.ts) since document.title
// collapses whitespace runs, so the displayed suffix should match what the
// browser would store even if a caller passes a messier value some other way.
const LABEL = INSTANCE_LABEL.replace(/\s+/g, ' ');
const SUFFIX = LABEL ? ` ${LABEL}` : '';

/**
 * Returns the instance-label suffix to append to a page's own `<title>`
 * (empty string when unset). Every page that renders a `<title>` composes it
 * with this suffix directly - there's no global mechanism that reaches
 * titles a page doesn't opt into.
 */
export function getTitleSuffix(): string {
  return SUFFIX;
}
