// Shared state machine for AI summarize UI — used by AISummarizeButton,
// AISummarizePatternButton, and any future summarize surfaces (alerts, etc.).
//
// Consumers provide:
// - subject: identifies the backend prompt + analyzing label
// - formatContent: builds the prompt text from the subject's input
// - easterEggFallback: optional synchronous local generator for non-AI mode
// - traceContext: optional lazy trace span fetcher config
//
// The hook handles: panel open/close, loading, error, dismiss, tone state +
// persistence, regenerate, and the real-AI-vs-easter-egg branch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import { useAISummarize } from '@/hooks/ai';
import { useSource } from '@/source';

import { useEventsAroundFocus } from '../DBTraceWaterfallChart';

import { AISummarizeTone, getSavedTone, saveTone } from './helpers';
import { dismissEasterEgg, isEasterEggVisible, isSmartMode } from './helpers';
import { Theme } from './logic';
import { SummarySubject } from './subjects';
import { buildTraceContext, TraceSpan } from './traceContext';

export interface TraceContextFetchArgs {
  traceId?: string;
  traceSourceId?: string | null;
  dateRange?: [Date, Date];
  focusDate?: Date;
}

export interface UseAISummarizeStateArgs<TInput> {
  subject: SummarySubject<TInput>;
  input: TInput;
  easterEggFallback?: () => { text: string; theme: Theme };
  traceContext?: TraceContextFetchArgs;
}

export interface UseAISummarizeStateResult {
  // Visibility
  visible: boolean;
  // Panel props
  isOpen: boolean;
  isGenerating: boolean;
  result: { text: string; theme?: Theme } | null;
  error: string | null;
  tone: AISummarizeTone;
  isRealAI: boolean;
  // Handlers
  onToggle: () => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  onToneChange: ((t: AISummarizeTone) => void) | undefined;
}

// Reset-on-input-change: if the consumer's input changes while a summary is
// open (e.g. user clicks a different row in a list), discard the stale result.
// We stringify because inputs are arbitrary shapes.
function useInputResetKey(input: unknown): string {
  return useMemo(() => {
    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }, [input]);
}

export function useAISummarizeState<TInput>({
  subject,
  input,
  easterEggFallback,
  traceContext,
}: UseAISummarizeStateArgs<TInput>): UseAISummarizeStateResult {
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
  const [traceContextNeeded, setTraceContextNeeded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingToneRef = useRef<AISummarizeTone | undefined>(undefined);
  const abortRef = useRef(false); // set true when input changes mid-flight

  const summarize = useAISummarize();

  // Reset when input changes (e.g. user selects a different row).
  // Skip the first render — only abort on genuine input transitions.
  const inputKey = useInputResetKey(input);
  const prevKeyRef = useRef(inputKey);
  useEffect(() => {
    if (prevKeyRef.current === inputKey) return;
    prevKeyRef.current = inputKey;
    abortRef.current = true;
    setResult(null);
    setError(null);
    setIsGenerating(false);
    setIsOpen(false);
    setTraceContextNeeded(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // release abort flag synchronously on next microtask — in-flight
    // callbacks queued before this point see abortRef=true and bail out;
    // any mutate() called *after* this runs works normally.
    queueMicrotask(() => {
      abortRef.current = false;
    });
  }, [inputKey]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Lazy trace span fetch — only fires when traceContextNeeded is true
  const { data: traceSourceData } = useSource({
    id: traceContext?.traceSourceId ?? undefined,
  });
  const traceSource = useMemo(
    () => (traceSourceData?.kind === 'trace' ? traceSourceData : undefined),
    [traceSourceData],
  );
  // Stub source so useEventsAroundFocus's internal useMemo doesn't crash
  // on source.kind access when the real source hasn't loaded yet.
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
  const fallbackDate = useMemo(() => new Date(0), []);
  const fallbackRange = useMemo(
    () => [fallbackDate, fallbackDate] as [Date, Date],
    [fallbackDate],
  );
  const hasTraceCtxConfig =
    subject.supportsTraceContext &&
    !!traceContext?.traceId &&
    !!traceContext?.traceSourceId;
  const { rows: traceSpans, isFetching: isFetchingTraceSpans } =
    useEventsAroundFocus({
      tableSource: traceSource ?? stubSource,
      focusDate: traceContext?.focusDate ?? fallbackDate,
      dateRange: traceContext?.dateRange ?? fallbackRange,
      traceId: traceContext?.traceId ?? '',
      enabled: !!(traceContextNeeded && hasTraceCtxConfig && traceSource),
    });

  const fireRequest = useCallback(
    (
      toneOverride: AISummarizeTone | undefined,
      traceCtx: string | undefined,
    ) => {
      const content = subject.formatContent(input, { traceContext: traceCtx });
      summarize.mutate(
        {
          kind: subject.kind,
          content,
          tone: toneOverride ?? tone,
        },
        {
          onSuccess: data => {
            if (abortRef.current) return;
            setResult({ text: data.summary });
            setIsGenerating(false);
          },
          onError: err => {
            if (abortRef.current) return;
            setError(err.message || 'Failed to generate summary');
            setIsGenerating(false);
          },
        },
      );
    },
    [input, subject, summarize, tone],
  );

  // When lazy-fetched trace spans arrive (or the fetch resolves with zero
  // rows), fire the AI request exactly once per pending trigger.
  useEffect(() => {
    if (!traceContextNeeded) return;
    if (isFetchingTraceSpans) return; // still loading
    // Fetch done — either we have spans or we don't; fire anyway with
    // whatever context we could build (empty string if no spans).
    const traceCtx =
      traceSpans.length > 0 ? buildTraceContext(traceSpans) : undefined;
    fireRequest(pendingToneRef.current, traceCtx);
    setTraceContextNeeded(false);
  }, [traceContextNeeded, isFetchingTraceSpans, traceSpans, fireRequest]);

  const handleRealAI = useCallback(
    (toneOverride?: AISummarizeTone) => {
      setIsGenerating(true);
      setIsOpen(true);
      setError(null);
      pendingToneRef.current = toneOverride;

      if (hasTraceCtxConfig && traceSource) {
        if (traceSpans.length > 0) {
          fireRequest(toneOverride, buildTraceContext(traceSpans));
        } else {
          setTraceContextNeeded(true);
        }
        return;
      }
      fireRequest(toneOverride, undefined);
    },
    [hasTraceCtxConfig, traceSource, traceSpans, fireRequest],
  );

  const handleFakeAI = useCallback(() => {
    if (!easterEggFallback) return;
    setIsGenerating(true);
    setIsOpen(true);
    timerRef.current = setTimeout(() => {
      setResult(easterEggFallback());
      setIsGenerating(false);
      timerRef.current = null;
    }, 1800);
  }, [easterEggFallback]);

  const onToggle = useCallback(() => {
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

  const onRegenerate = useCallback(() => {
    setResult(null);
    setError(null);
    if (aiEnabled) {
      handleRealAI();
    } else if (easterEggFallback) {
      setIsGenerating(true);
      timerRef.current = setTimeout(() => {
        setResult(easterEggFallback());
        setIsGenerating(false);
        timerRef.current = null;
      }, 1200);
    }
  }, [aiEnabled, handleRealAI, easterEggFallback]);

  const onDismiss = useCallback(() => {
    if (!aiEnabled) dismissEasterEgg();
    setIsOpen(false);
    setTimeout(() => setDismissed(true), 300);
  }, [aiEnabled]);

  const onToneChange = useCallback(
    (t: AISummarizeTone) => {
      setTone(t);
      saveTone(t);
      setResult(null);
      handleRealAI(t);
    },
    [handleRealAI],
  );

  // Visible if: AI enabled (always), or easter egg window active (with fallback)
  const visible =
    !dismissed && (aiEnabled || (showEasterEgg && !!easterEggFallback));

  return {
    visible,
    isOpen,
    isGenerating,
    result,
    error,
    tone,
    isRealAI: aiEnabled,
    onToggle,
    onRegenerate,
    onDismiss,
    onToneChange: aiEnabled && smartMode ? onToneChange : undefined,
  };
}

// Re-export helper types used by subject definitions
export type { TraceSpan };
