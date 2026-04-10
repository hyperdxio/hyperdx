import { useCallback, useEffect, useRef, useState } from 'react';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  buildEventSummaryPayload,
  requestAISummary,
} from './aiSummarize/request';
import {
  AISummaryTone,
  getAISummaryTonePreference,
  isSmartSummaryModeEnabled,
  RowData,
  setAISummaryTonePreference,
} from './aiSummarize';

export default function AISummarizeButton({
  rowData,
  severityText,
}: {
  rowData?: RowData;
  severityText?: string;
}) {
  const isSmartMode = isSmartSummaryModeEnabled();
  const [result, setResult] = useState<{
    text: string;
    tone?: AISummaryTone;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [tone, setTone] = useState<AISummaryTone>(() =>
    getAISummaryTonePreference(),
  );
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  const generateSummary = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setIsGenerating(true);
    try {
      const summary = await requestAISummary({
        ...buildEventSummaryPayload({
          rowData: rowData ?? {},
          severityText,
        }),
        tone,
      });
      if (requestIdRef.current !== currentRequestId) {
        return;
      }
      setResult({ text: summary, tone });
    } catch {
      if (requestIdRef.current !== currentRequestId) {
        return;
      }
      setResult({
        text: 'Unable to generate AI summary right now. Please try again.',
        tone,
      });
    } finally {
      if (requestIdRef.current === currentRequestId) {
        setIsGenerating(false);
      }
    }
  }, [rowData, severityText, tone]);

  const handleClick = useCallback(() => {
    if (result) {
      setIsOpen(prev => !prev);
      return;
    }
    setIsOpen(true);
    void generateSummary();
  }, [generateSummary, result]);

  const handleRegenerate = useCallback(() => {
    void generateSummary();
  }, [generateSummary]);

  return (
    <AISummaryPanel
      isOpen={isOpen}
      isGenerating={isGenerating}
      result={result}
      onToggle={handleClick}
      onRegenerate={handleRegenerate}
      tone={tone}
      onToneChange={nextTone => {
        if (!isSmartMode) {
          return;
        }
        setAISummaryTonePreference(nextTone);
        setTone(nextTone);
        setResult(null);
      }}
      analyzingLabel="Analyzing event data..."
    />
  );
}
