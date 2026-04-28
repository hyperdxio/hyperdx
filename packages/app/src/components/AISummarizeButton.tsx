import { useMemo } from 'react';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  EVENT_SUBJECT,
  EventSubjectInput,
  generateSummary,
  RowData,
  useAISummarizeState,
} from './aiSummarize';

// Re-exported for tests that still import this symbol
export { formatEventContent } from './aiSummarize/eventSubject';

export default function AISummarizeButton({
  rowData,
  severityText,
  traceId,
  traceSourceId,
  dateRange,
  focusDate,
}: {
  rowData?: RowData;
  severityText?: string;
  traceId?: string;
  traceSourceId?: string | null;
  dateRange?: [Date, Date];
  focusDate?: Date;
}) {
  const input = useMemo<EventSubjectInput>(
    () => ({ rowData: rowData ?? {}, severityText }),
    [rowData, severityText],
  );

  const state = useAISummarizeState<EventSubjectInput>({
    subject: EVENT_SUBJECT,
    input,
    easterEggFallback: () => generateSummary(rowData ?? {}, severityText),
    traceContext: { traceId, traceSourceId, dateRange, focusDate },
  });

  if (!state.visible) return null;

  return (
    <AISummaryPanel
      isOpen={state.isOpen}
      isGenerating={state.isGenerating}
      result={state.result}
      onToggle={state.onToggle}
      onRegenerate={state.onRegenerate}
      onDismiss={state.onDismiss}
      analyzingLabel={EVENT_SUBJECT.analyzingLabel}
      isRealAI={state.isRealAI}
      error={state.error}
      tone={state.tone}
      onToneChange={state.onToneChange}
    />
  );
}
