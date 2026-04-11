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
  dismissEasterEgg,
  generatePatternSummary,
  isEasterEggVisible,
  RowData,
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

function formatPatternContent(
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

  const handleRealAI = useCallback(() => {
    setIsGenerating(true);
    setIsOpen(true);
    setError(null);
    const content = formatPatternContent(pattern, serviceNameExpression);
    summarize.mutate(
      { type: 'pattern', content },
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
  }, [pattern, serviceNameExpression, summarize]);

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
    dismissEasterEgg();
    setIsOpen(false);
    setTimeout(() => setDismissed(true), 300);
  }, []);

  if (!aiEnabled && (dismissed || !showEasterEgg)) return null;

  return (
    <AISummaryPanel
      isOpen={isOpen}
      isGenerating={isGenerating}
      result={result}
      onToggle={handleClick}
      onRegenerate={handleRegenerate}
      onDismiss={aiEnabled ? undefined : handleDismiss}
      analyzingLabel="Analyzing pattern data..."
      isRealAI={aiEnabled}
      error={error}
    />
  );
}
