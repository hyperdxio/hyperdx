// AI Summarize public API.
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

// Subject registry + shared hook
export type { ClassifierSignals } from './classifiers';
export { isErrorEvent, isWarnEvent, normalizeSeverity } from './classifiers';
export type { EventSubjectInput } from './eventSubject';
export { EVENT_SUBJECT, formatEventContent } from './eventSubject';
export type { PatternSubjectInput } from './patternSubject';
export { formatPatternContent, PATTERN_SUBJECT } from './patternSubject';
export type { SummarySubject, SummarySubjectKind } from './subjects';
export {
  useAISummarizeState,
  type UseAISummarizeStateResult,
} from './useAISummarizeState';
