import { useCallback, useEffect, useRef, useState } from 'react';

import api from '@/api';
import { useAISummarize } from '@/hooks/ai';
import {
  Pattern,
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
} from '@/hooks/usePatterns';

import AISummaryPanel from './aiSummarize/AISummaryPanel';
import {
  AISummarizeTone,
  dismissEasterEgg,
  generatePatternSummary,
  getSavedTone,
  isEasterEggVisible,
  isSmartMode,
  RowData,
  saveTone,
  Theme,
} from './aiSummarize';

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

// Keys that are already shown elsewhere or not useful for AI context
const SKIP_KEYS = new Set([
  PATTERN_COLUMN_ALIAS,
  SEVERITY_TEXT_COLUMN_ALIAS,
  '__hdx_pk',
  'SortKey',
]);

export function formatPatternContent(
  pattern: Pattern,
  serviceNameExpression: string,
): string {
  const parts: string[] = [];

  parts.push(`Pattern: ${pattern.pattern}`);
  parts.push(`Occurrences: ${pattern.count}`);

  const samplesSlice = pattern.samples.slice(0, 5);
  if (samplesSlice.length > 0) {
    parts.push('Sample events:');
    for (const sample of samplesSlice) {
      const body = sample[PATTERN_COLUMN_ALIAS] ?? '';
      const svc = sample[serviceNameExpression] ?? '';
      const sev = sample[SEVERITY_TEXT_COLUMN_ALIAS] ?? '';
      parts.push(`  - [${sev}] ${svc}: ${body}`);

      // Include interesting attributes from the first sample only (to save tokens)
      if (sample === samplesSlice[0]) {
        const attrs = Object.entries(sample)
          .filter(
            ([k, v]) =>
              v != null &&
              v !== '' &&
              !SKIP_KEYS.has(k) &&
              !k.startsWith('__hdx_') &&
              k !== serviceNameExpression,
          )
          .slice(0, 15);
        if (attrs.length > 0) {
          parts.push(
            `    Attributes: ${attrs.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')}`,
          );
        }
      }
    }
  }

  return parts.join('\n');
}

export default function AISummarizePatternButton({
  pattern,
  serviceNameExpression,
}: {
  pattern: Pattern;
  serviceNameExpression: string;
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summarize = useAISummarize();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    setResult(null);
    setIsOpen(false);
    setIsGenerating(false);
    setError(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [pattern]);

  const handleRealAI = useCallback(
    (toneOverride?: AISummarizeTone) => {
      setIsGenerating(true);
      setIsOpen(true);
      setError(null);
      const content = formatPatternContent(pattern, serviceNameExpression);
      summarize.mutate(
        { type: 'pattern', content, tone: toneOverride ?? tone },
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
    [pattern, serviceNameExpression, summarize, tone],
  );

  const handleFakeAI = useCallback(() => {
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
  }, [pattern, serviceNameExpression]);

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
    }
  }, [aiEnabled, handleRealAI, pattern, serviceNameExpression]);

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
      analyzingLabel="Analyzing pattern data..."
      isRealAI={aiEnabled}
      error={error}
      tone={tone}
      onToneChange={aiEnabled && smartMode ? handleToneChange : undefined}
    />
  );
}
