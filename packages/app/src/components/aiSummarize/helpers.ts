// Easter egg: April Fools 2026 — shared helpers and types for AI Summarize.

import { renderMs } from '../TimelineChart/utils';

// ---------------------------------------------------------------------------
// Visibility gate
// ---------------------------------------------------------------------------
// Apr 1–6: always visible.
// Apr 7–30: only visible with ?smart=true in URL.
// May 1+: off entirely.
// Evaluated once at module load so it's stable across re-renders.

const ALWAYS_ON_END = new Date('2026-04-07T00:00:00').getTime();
const HARD_OFF = new Date('2026-05-01T00:00:00').getTime();
const DISMISS_KEY = 'hdx-ai-summarize-dismissed';
const TONE_KEY = 'hdx-ai-summarize-tone';

export type AISummarizeTone =
  | 'default'
  | 'noir'
  | 'attenborough'
  | 'shakespeare';

export const TONE_OPTIONS: { value: AISummarizeTone; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'noir', label: 'Detective Noir' },
  { value: 'attenborough', label: 'Nature Documentary' },
  { value: 'shakespeare', label: 'Shakespearean Drama' },
];

export function isSmartMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('smart') === 'true';
}

export function getSavedTone(): AISummarizeTone {
  try {
    const v = window.localStorage.getItem(TONE_KEY);
    if (v && TONE_OPTIONS.some(o => o.value === v)) return v as AISummarizeTone;
  } catch {
    // ignore
  }
  return 'default';
}

export function saveTone(tone: AISummarizeTone): void {
  try {
    window.localStorage.setItem(TONE_KEY, tone);
  } catch {
    // ignore
  }
}

// eslint-disable-next-line no-restricted-syntax -- one-time module-level check
const NOW_MS = new Date().getTime();

function isDismissed(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem(DISMISS_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function isEasterEggVisible(): boolean {
  if (NOW_MS >= HARD_OFF) return false;
  if (isDismissed()) return false;
  if (NOW_MS < ALWAYS_ON_END) return true;
  // Apr 7–30: require ?smart=true
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    return params.get('smart') === 'true';
  }
  return false;
}

export function dismissEasterEgg(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // localStorage unavailable — ignore
  }
}

export type RowData = Record<string, any>;

export interface EventFacts {
  service?: string;
  serviceVersion?: string;
  spanName?: string;
  spanKind?: string;
  durationMs?: number;
  statusCode?: string;
  severity?: string;
  httpMethod?: string;
  httpUrl?: string;
  httpStatus?: number;
  dbSystem?: string;
  dbStatement?: string;
  rpcMethod?: string;
  rpcService?: string;
  messagingSystem?: string;
  messagingDestination?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  k8sPod?: string;
  k8sNamespace?: string;
  k8sDeployment?: string;
  k8sCluster?: string;
  sdkLanguage?: string;
  hostName?: string;
  body?: string;
}

export type Mood = 'error' | 'warn' | 'slow' | 'normal';

export function short(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

export function fmtDuration(ms: number): string {
  // Use the same formatter as the trace waterfall for normal ranges
  if (ms < 60_000) return renderMs(ms);
  // Extended ranges for readability
  if (ms < 3_600_000) {
    const mins = (ms / 60_000).toFixed(1);
    return `~${mins}min`;
  }
  if (ms < 86_400_000) {
    const hrs = (ms / 3_600_000).toFixed(1);
    return `~${hrs}h`;
  }
  const days = Math.round(ms / 86_400_000);
  return `~${days} day${days !== 1 ? 's' : ''}`;
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
