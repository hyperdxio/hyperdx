/**
 * localStorage key for the one-time "View trace" button callout dismissal.
 *
 * Kept in this dependency-free module so it can be shared by the React
 * component and the Playwright fixture (which seeds it) without either copy
 * drifting from the other.
 */
export const VIEW_TRACE_CALLOUT_DISMISSED_KEY =
  'hdx-view-trace-callout-dismissed';
