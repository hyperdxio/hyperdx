import { useCallback, useEffect, useRef, useState } from 'react';

import api from '@/api';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  buildEventSummaryPayload,
  requestAISummary,
} from './aiSummarize/request';
import {
  AISummaryTone,
  getAISummaryTonePreference,
  isAISummaryDismissed,
  isSmartSummaryModeEnabled,
  RowData,
  setAISummaryDismissed,
  setAISummaryTonePreference,
} from './aiSummarize';

export default function AISummarizeButton({
  rowData,
  severityText,
  durationConfig,
}: {
  rowData?: RowData;
  severityText?: string;
  durationConfig?: {
    precision: number;
  };
}) {
  const { data: me } = api.useMe();
  const aiEnabled = me?.aiAssistantEnabled ?? true;
  const isSmartMode = isSmartSummaryModeEnabled();
  const [isDismissed, setIsDismissed] = useState(() =>
    isAISummaryDismissed(aiEnabled),
  );
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

  useEffect(() => {
    setIsDismissed(isAISummaryDismissed(aiEnabled));
  }, [aiEnabled]);

  const generateSummary = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setIsGenerating(true);
    try {
      const summary = await requestAISummary(
        {
          ...buildEventSummaryPayload({
            rowData: rowData ?? {},
            severityText,
            durationConfig,
          }),
          tone,
        },
        { aiEnabled },
      );
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
  }, [rowData, severityText, tone, aiEnabled, durationConfig]);

  const handleClick = useCallback(() => {
    if (!aiEnabled) {
      setIsOpen(prev => !prev);
      return;
    }
    if (result) {
      setIsOpen(prev => !prev);
      return;
    }
    setIsOpen(true);
    void generateSummary();
  }, [aiEnabled, generateSummary, result]);

  const handleRegenerate = useCallback(() => {
    void generateSummary();
  }, [generateSummary]);

  if (isDismissed) {
    return null;
  }

  return (
    <AISummaryPanel
      aiEnabled={aiEnabled}
      isOpen={isOpen}
      isGenerating={isGenerating}
      result={result}
      onToggle={handleClick}
      onRegenerate={handleRegenerate}
      onDismiss={() => {
        setAISummaryDismissed(aiEnabled);
        setIsDismissed(true);
        setIsOpen(false);
      }}
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
