import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import { useAISummarize } from '@/hooks/ai';
import { useSource } from '@/source';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  AISummarizeTone,
  buildTraceContext,
  dismissEasterEgg,
  generateSummary,
  getSavedTone,
  isEasterEggVisible,
  isSmartMode,
  RowData,
  saveTone,
  Theme,
} from './aiSummarize';
import { useEventsAroundFocus } from './DBTraceWaterfallChart';

export function formatEventContent(
  rowData: RowData,
  severityText?: string,
  traceContext?: string,
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

  if (traceContext) {
    parts.push('');
    parts.push(traceContext);
  }

  return parts.join('\n');
}

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
  const { data: me } = api.useMe();
  const aiEnabled = me?.aiAssistantEnabled ?? false;
  const showEasterEgg = isEasterEggVisible();
  const smartMode = isSmartMode();

  const [result, setResult] = useState<{
    text: string;
    theme?: Theme;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tone, setTone] = useState<AISummarizeTone>(getSavedTone);
  // Only fetch trace spans once the user clicks Summarize (lazy loading)
  const [traceContextNeeded, setTraceContextNeeded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summarize = useAISummarize();

  // Lazy trace span fetching — only fires when traceContextNeeded is true
  const { data: traceSourceData } = useSource({
    id: traceSourceId ?? undefined,
  });
  const traceSource = useMemo(
    () => (traceSourceData?.kind === 'trace' ? traceSourceData : undefined),
    [traceSourceData],
  );
  // Minimal stub source so getConfig inside useEventsAroundFocus doesn't crash
  // when the real source hasn't loaded yet. The hook's `enabled: false` prevents
  // any actual query — this just satisfies the useMemo that builds the config.
  const stubSource = useMemo<TTraceSource>(
    () =>
      ({
        kind: SourceKind.Trace,
        from: { databaseName: '', tableName: '' },
        timestampValueExpression: '',
        connection: '',
      }) as TTraceSource,
    [],
  );
  // Stable fallback date to avoid re-renders from new Date() in render path
  const fallbackDate = useMemo(() => new Date(0), []);
  const fallbackRange = useMemo(
    () => [fallbackDate, fallbackDate] as [Date, Date],
    [fallbackDate],
  );
  const { rows: traceSpans } = useEventsAroundFocus({
    tableSource: traceSource ?? stubSource,
    focusDate: focusDate ?? fallbackDate,
    dateRange: dateRange ?? fallbackRange,
    traceId: traceId ?? '',
    enabled: traceContextNeeded && !!traceSource && !!traceId,
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // When trace spans arrive, fire the AI request
  const pendingToneRef = useRef<AISummarizeTone | undefined>(undefined);
  useEffect(() => {
    if (traceContextNeeded && traceSpans.length > 0 && isGenerating) {
      const traceCtx = buildTraceContext(traceSpans);
      const content = formatEventContent(rowData ?? {}, severityText, traceCtx);
      summarize.mutate(
        { type: 'event', content, tone: pendingToneRef.current ?? tone },
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
      setTraceContextNeeded(false);
    }
  }, [traceContextNeeded, traceSpans]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRealAI = useCallback(
    (toneOverride?: AISummarizeTone) => {
      setIsGenerating(true);
      setIsOpen(true);
      setError(null);
      pendingToneRef.current = toneOverride;

      // If we have trace context available, use it immediately
      if (traceId && traceSource) {
        if (traceSpans.length > 0) {
          // Spans already cached — fire immediately
          const traceCtx = buildTraceContext(traceSpans);
          const content = formatEventContent(
            rowData ?? {},
            severityText,
            traceCtx,
          );
          summarize.mutate(
            { type: 'event', content, tone: toneOverride ?? tone },
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
        } else {
          // Trigger lazy fetch — the useEffect above fires the request when data arrives
          setTraceContextNeeded(true);
        }
        return;
      }

      // No trace context available — summarize single event
      const content = formatEventContent(rowData ?? {}, severityText);
      summarize.mutate(
        { type: 'event', content, tone: toneOverride ?? tone },
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
    },
    [rowData, severityText, summarize, tone, traceId, traceSource, traceSpans],
  );

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

  const handleToneChange = useCallback(
    (t: AISummarizeTone) => {
      setTone(t);
      saveTone(t);
      setResult(null);
      handleRealAI(t);
    },
    [handleRealAI],
  );

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
      tone={tone}
      onToneChange={aiEnabled && smartMode ? handleToneChange : undefined}
    />
  );
}
