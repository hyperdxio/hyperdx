export const AI_SUMMARY_TONES = [
  'default',
  'noir',
  'shakespeare',
  'attenborough',
] as const;

export type AISummaryTone = (typeof AI_SUMMARY_TONES)[number];

export const AI_SUMMARY_TONE_LABELS: Record<AISummaryTone, string> = {
  default: 'Standard',
  noir: 'Detective Noir',
  shakespeare: 'Shakespearean Drama',
  attenborough: 'Nature Documentary',
};

export type RowData = Record<string, unknown>;

const SMART_URL_PARAM = 'smart';
const TONE_STORAGE_KEY = 'hdx-ai-summary-tone';
const SUMMARY_DISMISS_STORAGE_KEY = 'hdx-ai-summary-dismissed-for';
type AISummaryDismissState = 'enabled' | 'disabled';

function shortText(value: string | undefined, maxChars: number): string {
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

export function stringifyValue(value: unknown, maxChars = 240): string {
  if (typeof value === 'string') return shortText(value, maxChars);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value == null) return '';
  try {
    return shortText(JSON.stringify(value), maxChars);
  } catch {
    return shortText(String(value), maxChars);
  }
}

function isSummaryTone(
  value: string | null | undefined,
): value is AISummaryTone {
  if (!value) return false;
  return (AI_SUMMARY_TONES as readonly string[]).includes(value);
}

export function isSmartSummaryModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    new URLSearchParams(window.location.search).get(SMART_URL_PARAM) === 'true'
  );
}

export function getAISummaryTonePreference(): AISummaryTone {
  if (!isSmartSummaryModeEnabled()) {
    return 'default';
  }

  try {
    const fromStorage = window.localStorage.getItem(TONE_STORAGE_KEY);
    if (isSummaryTone(fromStorage)) {
      return fromStorage;
    }
  } catch {
    // Ignore unavailable localStorage.
  }

  return 'default';
}

export function setAISummaryTonePreference(tone: AISummaryTone): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TONE_STORAGE_KEY, tone);
  } catch {
    // Ignore unavailable localStorage.
  }
}

function getAISummaryDismissState(): AISummaryDismissState | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(SUMMARY_DISMISS_STORAGE_KEY);
    if (value === 'enabled' || value === 'disabled') {
      return value;
    }
  } catch {
    // Ignore unavailable localStorage.
  }
  return null;
}

function getCurrentDismissState(aiEnabled: boolean): AISummaryDismissState {
  return aiEnabled ? 'enabled' : 'disabled';
}

export function isAISummaryDismissed(aiEnabled: boolean): boolean {
  const storedState = getAISummaryDismissState();
  if (!storedState) return false;

  const currentState = getCurrentDismissState(aiEnabled);
  if (storedState === currentState) {
    return true;
  }

  try {
    window.localStorage.removeItem(SUMMARY_DISMISS_STORAGE_KEY);
  } catch {
    // Ignore unavailable localStorage.
  }
  return false;
}

export function setAISummaryDismissed(aiEnabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SUMMARY_DISMISS_STORAGE_KEY,
      getCurrentDismissState(aiEnabled),
    );
  } catch {
    // Ignore unavailable localStorage.
  }
}
