import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Pattern,
  SEVERITY_TEXT_COLUMN_ALIAS,
} from '@/hooks/usePatterns';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  AISummaryTone,
  getAISummaryTonePreference,
  isSmartSummaryModeEnabled,
  setAISummaryTonePreference,
} from './aiSummarize';
import {
  buildPatternSummaryPayload,
  requestAISummary,
} from './aiSummarize/request';

export default function AISummarizePatternButton({
  pattern,
  serviceNameExpression,
}: {
  pattern: Pattern;
  serviceNameExpression: string;
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

  // Reset when pattern changes.
  useEffect(() => {
    setResult(null);
    setIsOpen(false);
    setIsGenerating(false);
  }, [pattern]);

  const generateSummary = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    setIsGenerating(true);
    try {
      const summary = await requestAISummary({
        ...buildPatternSummaryPayload({
          patternName: pattern.pattern,
          count: pattern.count,
          severityText: pattern.samples[0]?.[SEVERITY_TEXT_COLUMN_ALIAS],
          samples: pattern.samples,
          serviceNameExpression,
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
  }, [pattern, serviceNameExpression, tone]);

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
      analyzingLabel="Analyzing pattern data..."
    />
  );
}
