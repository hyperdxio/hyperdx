// Easter egg: April Fools 2026 — see aiSummarize/ for details.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Pattern,
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
} from '@/hooks/usePatterns';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  dismissEasterEgg,
  generatePatternSummary,
  isEasterEggVisible,
  RowData,
  Theme,
} from './aiSummarize';

/**
 * Build a synthetic RowData from the first sample event so the summary
 * generators can extract OTel facts (service, severity, body, etc.).
 */
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
      // Pass through any other fields the sample may have (attributes, etc.)
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
  const [result, setResult] = useState<{
    text: string;
    theme: Theme;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Reset when pattern changes.
  useEffect(() => {
    setResult(null);
    setIsOpen(false);
    setIsGenerating(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [pattern]);

  const handleClick = useCallback(() => {
    if (result) {
      setIsOpen(prev => !prev);
      return;
    }
    setIsGenerating(true);
    setIsOpen(true);
    const { rowData, severityText } = buildRowDataFromSample(
      pattern,
      serviceNameExpression,
    );
    timerRef.current = setTimeout(() => {
      setResult(
        generatePatternSummary(
          pattern.pattern,
          pattern.count,
          rowData,
          severityText,
        ),
      );
      setIsGenerating(false);
      timerRef.current = null;
    }, 1800);
  }, [pattern, serviceNameExpression, result]);

  const handleRegenerate = useCallback(() => {
    setIsGenerating(true);
    const { rowData, severityText } = buildRowDataFromSample(
      pattern,
      serviceNameExpression,
    );
    timerRef.current = setTimeout(() => {
      setResult(
        generatePatternSummary(
          pattern.pattern,
          pattern.count,
          rowData,
          severityText,
        ),
      );
      setIsGenerating(false);
      timerRef.current = null;
    }, 1200);
  }, [pattern, serviceNameExpression]);

  const handleDismiss = useCallback(() => {
    dismissEasterEgg();
    setIsOpen(false);
    // Let Collapse animate closed before unmounting.
    setTimeout(() => setDismissed(true), 300);
  }, []);

  if (dismissed || !isEasterEggVisible()) return null;

  return (
    <AISummaryPanel
      isOpen={isOpen}
      isGenerating={isGenerating}
      result={result}
      onToggle={handleClick}
      onRegenerate={handleRegenerate}
      onDismiss={handleDismiss}
      analyzingLabel="Analyzing pattern data..."
    />
  );
}
