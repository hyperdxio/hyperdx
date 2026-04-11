import { useCallback, useEffect, useRef, useState } from 'react';

import api from '@/api';
import { useAISummarize } from '@/hooks/ai';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  dismissEasterEgg,
  generateSummary,
  isEasterEggVisible,
  RowData,
  Theme,
} from './aiSummarize';

export function formatEventContent(
  rowData: RowData,
  severityText?: string,
): string {
  const parts: string[] = [];

  if (severityText) parts.push(`Severity: ${severityText}`);

  const body = rowData.__hdx_body;
  if (body)
    parts.push(
      `Body: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );

  if (rowData.ServiceName) parts.push(`Service: ${rowData.ServiceName}`);
  if (rowData.SpanName) parts.push(`Span: ${rowData.SpanName}`);
  if (rowData.StatusCode) parts.push(`Status: ${rowData.StatusCode}`);
  if (rowData.Duration) parts.push(`Duration: ${rowData.Duration}ns`);

  const attrs = rowData.__hdx_event_attributes;
  if (attrs && typeof attrs === 'object') {
    const interesting = Object.entries(attrs)
      .filter(([, v]) => v != null && v !== '')
      .slice(0, 20);
    if (interesting.length > 0) {
      parts.push(
        `Attributes: ${interesting.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      );
    }
  }

  const res = rowData.__hdx_resource_attributes;
  if (res && typeof res === 'object') {
    const interesting = Object.entries(res)
      .filter(([, v]) => v != null && v !== '')
      .slice(0, 10);
    if (interesting.length > 0) {
      parts.push(
        `Resource: ${interesting.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      );
    }
  }

  const exc = rowData.__hdx_events_exception_attributes;
  if (exc && typeof exc === 'object') {
    if (exc['exception.type'])
      parts.push(`Exception: ${exc['exception.type']}`);
    if (exc['exception.message'])
      parts.push(`Exception message: ${exc['exception.message']}`);
  }

  return parts.join('\n');
}

export default function AISummarizeButton({
  rowData,
  severityText,
}: {
  rowData?: RowData;
  severityText?: string;
}) {
  const { data: me } = api.useMe();
  const aiEnabled = me?.aiAssistantEnabled ?? false;
  const showEasterEgg = isEasterEggVisible();

  const [result, setResult] = useState<{
    text: string;
    theme?: Theme;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summarize = useAISummarize();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleRealAI = useCallback(() => {
    setIsGenerating(true);
    setIsOpen(true);
    setError(null);
    const content = formatEventContent(rowData ?? {}, severityText);
    summarize.mutate(
      { type: 'event', content },
      {
        onSuccess: data => {
          setResult({ text: data.summary });
          setIsGenerating(false);
        },
        onError: err => {
          setError(err.message || 'Failed to generate summary');
          setIsGenerating(false);
        },
      },
    );
  }, [rowData, severityText, summarize]);

  const handleFakeAI = useCallback(() => {
    setIsGenerating(true);
    setIsOpen(true);
    timerRef.current = setTimeout(() => {
      setResult(generateSummary(rowData ?? {}, severityText));
      setIsGenerating(false);
      timerRef.current = null;
    }, 1800);
  }, [rowData, severityText]);

  const handleClick = useCallback(() => {
    if (result) {
      setIsOpen(prev => !prev);
      return;
    }
    if (aiEnabled) {
      handleRealAI();
    } else {
      handleFakeAI();
    }
  }, [result, aiEnabled, handleRealAI, handleFakeAI]);

  const handleRegenerate = useCallback(() => {
    setResult(null);
    setError(null);
    if (aiEnabled) {
      handleRealAI();
    } else {
      setIsGenerating(true);
      timerRef.current = setTimeout(() => {
        setResult(generateSummary(rowData ?? {}, severityText));
        setIsGenerating(false);
        timerRef.current = null;
      }, 1200);
    }
  }, [aiEnabled, handleRealAI, rowData, severityText]);

  const handleDismiss = useCallback(() => {
    if (!aiEnabled) {
      dismissEasterEgg();
    }
    setIsOpen(false);
    setTimeout(() => setDismissed(true), 300);
  }, [aiEnabled]);

  // Real AI: always visible unless user dismissed this instance.
  // Easter egg: visible only within the time-gated window + not dismissed.
  if (dismissed) return null;
  if (!aiEnabled && !showEasterEgg) return null;

  return (
    <AISummaryPanel
      isOpen={isOpen}
      isGenerating={isGenerating}
      result={result}
      onToggle={handleClick}
      onRegenerate={handleRegenerate}
      onDismiss={handleDismiss}
      analyzingLabel="Analyzing event data..."
      isRealAI={aiEnabled}
      error={error}
    />
  );
}
