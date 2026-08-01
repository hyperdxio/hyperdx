// Easter egg: April Fools 2026 — see aiSummarize/ for details.
import { useCallback, useEffect, useRef, useState } from 'react';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  dismissEasterEgg,
  generateSummary,
  isEasterEggVisible,
  RowData,
  Theme,
} from './aiSummarize';

export default function AISummarizeButton({
  rowData,
  severityText,
}: {
  rowData?: RowData;
  severityText?: string;
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

  const handleClick = useCallback(() => {
    if (result) {
      setIsOpen(prev => !prev);
      return;
    }
    setIsGenerating(true);
    setIsOpen(true);
    timerRef.current = setTimeout(() => {
      setResult(generateSummary(rowData ?? {}, severityText));
      setIsGenerating(false);
      timerRef.current = null;
    }, 1800);
  }, [rowData, severityText, result]);

  const handleRegenerate = useCallback(() => {
    setIsGenerating(true);
    timerRef.current = setTimeout(() => {
      setResult(generateSummary(rowData ?? {}, severityText));
      setIsGenerating(false);
      timerRef.current = null;
    }, 1200);
  }, [rowData, severityText]);

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
      analyzingLabel="Analyzing event data..."
    />
  );
}
