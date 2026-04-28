import { useMemo } from 'react';

import {
  Pattern,
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
} from '@/hooks/usePatterns';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  generatePatternSummary,
  PATTERN_SUBJECT,
  PatternSubjectInput,
  RowData,
  useAISummarizeState,
} from './aiSummarize';

// Re-exported for tests that still import this symbol
export { formatPatternContent } from './aiSummarize/patternSubject';

function buildRowDataFromSample(
  pattern: Pattern,
  serviceNameExpression: string,
): { rowData: RowData; severityText?: string } {
  const sample = pattern.samples[0];
  if (!sample) return { rowData: {} };
  return {
    rowData: {
      __hdx_body: sample[PATTERN_COLUMN_ALIAS],
      ServiceName: sample[serviceNameExpression],
      __hdx_severity_text: sample[SEVERITY_TEXT_COLUMN_ALIAS],
      ...sample,
    },
    severityText: sample[SEVERITY_TEXT_COLUMN_ALIAS],
  };
}

export default function AISummarizePatternButton({
  pattern,
  serviceNameExpression,
}: {
  pattern: Pattern;
  serviceNameExpression: string;
}) {
  const input = useMemo<PatternSubjectInput>(
    () => ({ pattern, serviceNameExpression }),
    [pattern, serviceNameExpression],
  );

  const state = useAISummarizeState<PatternSubjectInput>({
    subject: PATTERN_SUBJECT,
    input,
    easterEggFallback: () => {
      const { rowData, severityText } = buildRowDataFromSample(
        pattern,
        serviceNameExpression,
      );
      return generatePatternSummary(
        pattern.pattern,
        pattern.count,
        rowData,
        severityText,
      );
    },
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
      analyzingLabel={PATTERN_SUBJECT.analyzingLabel}
      isRealAI={state.isRealAI}
      error={state.error}
      tone={state.tone}
      onToneChange={state.onToneChange}
    />
  );
}
