import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemo } from 'react';
import { TLogSource, TTraceSource } from '@hyperdx/common-utils/dist/types';

import api from '@/api';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  buildTraceSummaryPayload,
  requestAISummary,
} from './aiSummarize/request';
import {
  AISummaryTone,
  getAISummaryTonePreference,
  isAISummaryDismissed,
  isSmartSummaryModeEnabled,
  setAISummaryDismissed,
  setAISummaryTonePreference,
} from './aiSummarize';
import { useEventsAroundFocus } from './DBTraceWaterfallChart';

export default function AISummarizeTraceButton({
  traceId,
  traceTableSource,
  logTableSource,
  dateRange,
  focusDate,
}: {
  traceId: string;
  traceTableSource: TTraceSource;
  logTableSource: TLogSource | null;
  dateRange: [Date, Date];
  focusDate: Date;
}) {
  const { data: me } = api.useMe();
  const aiEnabled = me?.aiAssistantEnabled ?? true;
  const isSmartMode = isSmartSummaryModeEnabled();
  const [isDismissed, setIsDismissed] = useState<boolean>(() =>
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

  const { rows: traceRows } = useEventsAroundFocus({
    tableSource: traceTableSource,
    focusDate,
    dateRange,
    traceId,
    enabled: true,
  });
  const { rows: logRows } = useEventsAroundFocus({
    tableSource: logTableSource ?? traceTableSource,
    focusDate,
    dateRange: logTableSource ? dateRange : [dateRange[1], dateRange[0]],
    traceId,
    enabled: logTableSource != null,
  });
  const rows = useMemo(
    () => [...traceRows, ...logRows] as Array<Record<string, unknown>>,
    [traceRows, logRows],
  );

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setResult(null);
    setIsOpen(false);
    setIsGenerating(false);
  }, [traceId]);

  useEffect(() => {
    setIsDismissed(isAISummaryDismissed(aiEnabled));
  }, [aiEnabled]);

  const generateSummary = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setIsGenerating(true);
    try {
      const summary = await requestAISummary(
        {
          ...buildTraceSummaryPayload({
            traceId,
            rows,
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
  }, [traceId, rows, tone, aiEnabled]);

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
      analyzingLabel="Analyzing trace data..."
    />
  );
}
