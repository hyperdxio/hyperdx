// Easter egg: April Fools 2026 — core logic for AI Summarize.
// No real AI is involved. The summaries are randomly assembled from
// hand-written phrase pools themed as Detective Noir, Shakespearean Drama,
// and David Attenborough Nature Documentary.
// Active until end of April 2026 — see AISummarizeButton.tsx for the gate.

import { attenboroughSummary } from './attenboroughTheme';
import { EventFacts, Mood, pick, RowData, short } from './helpers';
import { noirSummary } from './noirTheme';
import { shakespeareSummary } from './shakespeareTheme';

// ---------------------------------------------------------------------------
// Data extraction -- pull structured facts from OTel / K8s attributes
// ---------------------------------------------------------------------------

function extractFacts(row: RowData, severityText?: string): EventFacts {
  const attrs = row.__hdx_event_attributes ?? {};
  const res = row.__hdx_resource_attributes ?? {};
  const exc = row.__hdx_events_exception_attributes ?? {};
  const rawDuration = row.Duration != null ? Number(row.Duration) : undefined;
  // Duration from useRowData comes as the raw column value (not converted).
  // OTel default durationPrecision=9 means nanoseconds. Always divide by
  // 1e6 to get milliseconds -- this matches the default OTel schema and
  // the HyperDX demo. For non-default precisions the timing will be
  // slightly off but this is a novelty feature so that's fine.
  const durationMs =
    rawDuration != null && !isNaN(rawDuration) && rawDuration > 0
      ? rawDuration / 1e6
      : undefined;

  return {
    service: row.ServiceName || res['service.name'],
    serviceVersion: res['service.version'],
    spanName: row.SpanName || row.__hdx_body,
    spanKind: row.SpanKind,
    durationMs,
    statusCode: row.StatusCode,
    severity: severityText,
    httpMethod: attrs['http.method'] || attrs['http.request.method'],
    httpUrl:
      attrs['http.url'] ||
      attrs['url.full'] ||
      attrs['http.target'] ||
      attrs['url.path'],
    httpStatus: (() => {
      const s = attrs['http.status_code'] || attrs['http.response.status_code'];
      return s ? Number(s) : undefined;
    })(),
    dbSystem: attrs['db.system'],
    dbStatement: attrs['db.statement'],
    rpcMethod: attrs['rpc.method'],
    rpcService: attrs['rpc.service'],
    messagingSystem: attrs['messaging.system'],
    messagingDestination:
      attrs['messaging.destination'] || attrs['messaging.destination.name'],
    exceptionType: exc['exception.type'],
    exceptionMessage: (() => {
      const m = exc['exception.message'];
      return typeof m === 'string' ? m : m ? JSON.stringify(m) : undefined;
    })(),
    k8sPod: res['k8s.pod.name'],
    k8sNamespace: res['k8s.namespace.name'],
    k8sDeployment: res['k8s.deployment.name'],
    k8sCluster: res['k8s.cluster.name'],
    sdkLanguage: res['telemetry.sdk.language'] || res['telemetry.sdk.name'],
    hostName: res['host.name'] || res['host.id'],
    body:
      typeof row.__hdx_body === 'string'
        ? row.__hdx_body
        : row.__hdx_body != null
          ? JSON.stringify(row.__hdx_body)
          : undefined,
  };
}

// Classify event mood based on severity, status code, exception
function classifyMood(f: EventFacts): Mood {
  const sev = f.severity?.toLowerCase();
  if (
    sev === 'error' ||
    sev === 'fatal' ||
    sev === 'critical' ||
    f.statusCode === 'STATUS_CODE_ERROR' ||
    f.exceptionType ||
    (f.httpStatus && f.httpStatus >= 500)
  )
    return 'error';
  if (
    sev === 'warn' ||
    sev === 'warning' ||
    (f.httpStatus && f.httpStatus >= 400)
  )
    return 'warn';
  if (f.durationMs != null && f.durationMs > 5000) return 'slow';
  return 'normal';
}

// ---------------------------------------------------------------------------
// Theme selection -- deterministic based on event context
// ---------------------------------------------------------------------------

export type Theme = 'noir' | 'attenborough' | 'shakespeare';

export const THEME_LABELS: Record<Theme, string> = {
  noir: 'Detective Noir',
  attenborough: 'Nature Documentary',
  shakespeare: 'Shakespearean Drama',
};

type ThemeFn = (f: EventFacts, mood: Mood) => string;
const THEME_FNS: Record<Theme, ThemeFn> = {
  noir: noirSummary,
  attenborough: attenboroughSummary,
  shakespeare: shakespeareSummary,
};

// Error/exception -> noir (crime scene)
// Slow/performance -> shakespeare (dramatic suffering)
// Warning -> pick noir or shakespeare
// Normal/info -> attenborough (nature observation)
function selectTheme(mood: Mood): Theme {
  switch (mood) {
    case 'error':
      return pick(['noir', 'noir', 'shakespeare'] as Theme[]);
    case 'warn':
      return pick(['noir', 'shakespeare'] as Theme[]);
    case 'slow':
      return pick(['shakespeare', 'shakespeare', 'attenborough'] as Theme[]);
    case 'normal':
      return pick([
        'attenborough',
        'attenborough',
        'shakespeare',
        'noir',
      ] as Theme[]);
  }
}

export function generateSummary(
  row: RowData,
  severityText?: string,
): { text: string; theme: Theme } {
  const facts = extractFacts(row, severityText);
  const mood = classifyMood(facts);
  const theme = selectTheme(mood);
  return { text: THEME_FNS[theme](facts, mood), theme };
}

// ---------------------------------------------------------------------------
// Pattern-specific summary — uses pattern name + first sample + count
// ---------------------------------------------------------------------------

function patternPreamble(
  patternName: string,
  count: number,
  theme: Theme,
): string {
  const fmtCount = count.toLocaleString();
  switch (theme) {
    case 'noir':
      return pick([
        `The same message kept turning up: "${short(patternName, 70)}". Not once, not twice -- ${fmtCount} times. That's not a coincidence. That's a pattern.`,
        `I opened the case file and found ${fmtCount} identical reports: "${short(patternName, 70)}". Somebody was being very repetitive. Or very broken.`,
        `"${short(patternName, 70)}" -- the logs were full of it. ${fmtCount} occurrences. Like a suspect repeating the same alibi over and over.`,
        `${fmtCount} witnesses, all telling the same story: "${short(patternName, 70)}". Either they're all telling the truth, or the system has a stutter.`,
        `The evidence was overwhelming. ${fmtCount} instances of "${short(patternName, 70)}". In my experience, when a log repeats that many times, it's either very healthy or very sick.`,
      ]);
    case 'attenborough':
      return pick([
        `What we observe here is a remarkable colonial behavior: the same message -- "${short(patternName, 70)}" -- repeated ${fmtCount} times. In nature, such repetition serves a purpose. In software, it usually means someone forgot to add rate limiting.`,
        `"${short(patternName, 70)}" -- this call echoes across the cluster ${fmtCount} times. Like the synchronized chirping of a cricket colony, it is both impressive and slightly concerning.`,
        `Here we witness one of the most prolific species in the log ecosystem: "${short(patternName, 70)}". With ${fmtCount} specimens observed, it dominates this particular habitat.`,
        `Extraordinary. The pattern "${short(patternName, 70)}" has been recorded ${fmtCount} times. One is reminded of the starling murmuration -- thousands of individuals, one pattern, endlessly repeated.`,
        `In the dense undergrowth of the log stream, one pattern rises above the rest: "${short(patternName, 70)}". ${fmtCount} instances. A dominant species, thriving in these conditions.`,
      ]);
    case 'shakespeare':
      return pick([
        `"${short(patternName, 70)}" -- so says the log, not once but ${fmtCount} times! "Methinks the service doth protest too much."`,
        `Hark! A refrain most persistent: "${short(patternName, 70)}". ${fmtCount} times it echoes through the cluster, like a chorus that hath forgotten how to stop.`,
        `"Once more unto the log, dear friends!" ${fmtCount} times hath this message -- "${short(patternName, 70)}" -- graced the stage. A soliloquy on infinite repeat.`,
        `"${short(patternName, 70)}" -- the opening line of a play performed ${fmtCount} times. Even Shakespeare did not demand such repetition from his actors.`,
        `Act I, Scene 1. And Scene 2. And Scene ${fmtCount}. The line is always the same: "${short(patternName, 70)}". "Brevity is the soul of wit," but nobody told this pattern.`,
      ]);
  }
}

export function generatePatternSummary(
  patternName: string,
  count: number,
  sampleRow: RowData,
  severityText?: string,
): { text: string; theme: Theme } {
  const facts = extractFacts(sampleRow, severityText);
  const mood = classifyMood(facts);
  const theme = selectTheme(mood);
  const preamble = patternPreamble(patternName, count, theme);
  const body = THEME_FNS[theme](facts, mood);
  // Replace the first paragraph (the generic opener) with our pattern preamble.
  const lines = body.split('\n\n');
  lines[0] = preamble;
  return { text: lines.join('\n\n'), theme };
}
