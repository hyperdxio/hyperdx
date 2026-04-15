// Easter egg: April Fools 2026 — AI Summarize public API.
export type { AISummarizeTone, RowData } from './helpers';
export {
  dismissEasterEgg,
  getSavedTone,
  isEasterEggVisible,
  isSmartMode,
  saveTone,
  TONE_OPTIONS,
} from './helpers';
export type { Theme } from './logic';
export { generatePatternSummary, generateSummary } from './logic';
export type { TraceSpan } from './traceContext';
export { buildTraceContext } from './traceContext';
