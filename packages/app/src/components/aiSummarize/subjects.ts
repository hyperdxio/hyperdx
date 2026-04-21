// Subject registry for AI summarization.
//
// Each summarize-able thing (log event, trace span, log pattern, future: alert,
// metric anomaly, service map incident) is a "subject" with:
// - A kind identifier sent to the API
// - A formatContent function that turns the subject's input into the text
//   the LLM will see
// - A label shown in the loading state
//
// Adding a new subject later means defining it here and rendering an
// <AISummaryPanel> bound to useAISummarizeState({ subject, input }).
// No changes needed in the hook or panel.

export type SummarySubjectKind = 'event' | 'pattern' | 'alert';

export interface SummarySubject<TInput> {
  kind: SummarySubjectKind;
  analyzingLabel: string;
  formatContent: (input: TInput, opts?: { traceContext?: string }) => string;
  // Whether this subject ever needs trace context enrichment.
  // Only 'event' subjects that belong to a trace consume this today.
  supportsTraceContext?: boolean;
}
