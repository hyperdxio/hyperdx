import { z } from 'zod';

const AI_SUMMARY_TONES = [
  'default',
  'noir',
  'shakespeare',
  'attenborough',
] as const;

type AISummaryTone = (typeof AI_SUMMARY_TONES)[number];

const summaryToneSchema = z.enum(AI_SUMMARY_TONES).default('default');

const keyValueSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
  count: z.number().int().nonnegative().optional(),
});

const eventContextSchema = z.object({
  title: z.string().max(240).optional(),
  body: z.string().max(4000).optional(),
  timestamp: z.string().max(120).optional(),
  service: z.string().max(200).optional(),
  severity: z.string().max(80).optional(),
  status: z.string().max(120).optional(),
  spanName: z.string().max(240).optional(),
  spanKind: z.string().max(120).optional(),
  durationMs: z.number().nonnegative().optional(),
  traceId: z.string().max(300).optional(),
  spanId: z.string().max(300).optional(),
  attributes: z.array(keyValueSchema).max(50).optional(),
});

const patternContextSchema = z.object({
  pattern: z.string().max(2000),
  count: z.number().int().nonnegative(),
  sampledRows: z.number().int().nonnegative().optional(),
  representativeSeverity: z.string().max(80).optional(),
  topServices: z.array(keyValueSchema).max(30).optional(),
  topAttributes: z.array(keyValueSchema).max(50).optional(),
  sampleMessages: z.array(z.string().min(1).max(1000)).max(30).optional(),
});

const traceItemSchema = z.object({
  service: z.string().max(200).optional(),
  name: z.string().max(400),
  durationMs: z.number().nonnegative().optional(),
  status: z.string().max(120).optional(),
  timestamp: z.string().max(120).optional(),
  type: z.enum(['span', 'log']).optional(),
  isError: z.boolean().optional(),
});

const traceContextSchema = z.object({
  traceId: z.string().max(300),
  spanCount: z.number().int().nonnegative(),
  logCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  warnCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  serviceStats: z.array(keyValueSchema).max(40).optional(),
  criticalPath: z.array(traceItemSchema).max(80).optional(),
  errorEvents: z.array(traceItemSchema).max(80).optional(),
  slowSpans: z.array(traceItemSchema).max(80).optional(),
});

export const AISummaryRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    tone: summaryToneSchema.optional(),
    context: eventContextSchema,
  }),
  z.object({
    kind: z.literal('pattern'),
    tone: summaryToneSchema.optional(),
    context: patternContextSchema,
  }),
  z.object({
    kind: z.literal('trace'),
    tone: summaryToneSchema.optional(),
    context: traceContextSchema,
  }),
]);

export type AISummaryRequest = z.infer<typeof AISummaryRequestSchema>;

function shortText(
  value: string | undefined,
  maxChars: number,
): string | undefined {
  if (value == null) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function trimKeyValues(
  items: Array<{ key: string; value: string; count?: number }> | undefined,
  maxItems: number,
  maxValueChars: number,
) {
  if (!items?.length) return [];
  return items.slice(0, maxItems).map(item => ({
    ...item,
    value: shortText(item.value, maxValueChars) ?? item.value,
  }));
}

function trimTraceItems(
  items:
    | Array<{
        service?: string;
        name: string;
        durationMs?: number;
        status?: string;
        timestamp?: string;
        type?: 'span' | 'log';
        isError?: boolean;
      }>
    | undefined,
  maxItems: number,
) {
  if (!items?.length) return [];
  return items.slice(0, maxItems).map(item => ({
    ...item,
    name: shortText(item.name, 220) ?? item.name,
    service: shortText(item.service, 140),
    status: shortText(item.status, 100),
  }));
}

export function compactSummaryRequest(
  payload: AISummaryRequest,
): AISummaryRequest {
  const tone = payload.tone ?? 'default';
  if (payload.kind === 'event') {
    return {
      kind: 'event',
      tone,
      context: {
        ...payload.context,
        title: shortText(payload.context.title, 180),
        body: shortText(payload.context.body, 1000),
        spanName: shortText(payload.context.spanName, 220),
        traceId: shortText(payload.context.traceId, 120),
        spanId: shortText(payload.context.spanId, 120),
        attributes: trimKeyValues(payload.context.attributes, 18, 180),
      },
    };
  }

  if (payload.kind === 'pattern') {
    return {
      kind: 'pattern',
      tone,
      context: {
        ...payload.context,
        pattern:
          shortText(payload.context.pattern, 500) ?? payload.context.pattern,
        sampleMessages: payload.context.sampleMessages
          ?.slice(0, 8)
          .map(message => shortText(message, 260) ?? message),
        topServices: trimKeyValues(payload.context.topServices, 10, 120),
        topAttributes: trimKeyValues(payload.context.topAttributes, 16, 120),
      },
    };
  }

  return {
    kind: 'trace',
    tone,
    context: {
      ...payload.context,
      traceId:
        shortText(payload.context.traceId, 120) ?? payload.context.traceId,
      serviceStats: trimKeyValues(payload.context.serviceStats, 10, 100),
      criticalPath: trimTraceItems(payload.context.criticalPath, 18),
      errorEvents: trimTraceItems(payload.context.errorEvents, 12),
      slowSpans: trimTraceItems(payload.context.slowSpans, 10),
    },
  };
}

const TONE_INSTRUCTIONS: Record<AISummaryTone, string> = {
  default:
    'Tone: direct, professional, and concise. Avoid jokes and dramatic wording.',
  noir: 'Tone: noir detective voice. Keep it readable, but add subtle noir flavor.',
  shakespeare:
    'Tone: light Shakespearean phrasing, while preserving technical clarity.',
  attenborough:
    'Tone: naturalist documentary narration with calm, observational style.',
};

export function getSummaryPrompt(payload: AISummaryRequest): {
  system: string;
  prompt: string;
  maxOutputTokens: number;
} {
  const compacted = compactSummaryRequest(payload);
  const tone = compacted.tone ?? 'default';

  const system = `You are an AI assistant for HyperDX, an observability platform.
- Use only the provided context; do not invent facts.
- Prioritize actionable findings over generic advice.
- If key data is missing, explicitly say so.
- Be concise and high-signal.`;

  const kindInstructions =
    compacted.kind === 'trace'
      ? `Task: Summarize this trace.
Prioritize:
1) failures/errors and likely blast radius
2) critical path bottlenecks and latency
3) concrete next investigation steps`
      : compacted.kind === 'pattern'
        ? `Task: Summarize this recurring log pattern.
Important:
- Do not state the obvious that the pattern repeats.
- Focus on whether this recurrence looks normal, noisy, or risky.
Prioritize:
1) strongest severity/service/environment signals
2) unusual concentrations, outliers, or drift from expected behavior
3) practical follow-up checks tied to impact`
        : `Task: Summarize this single event/log/span.
Prioritize:
1) what happened
2) severity/impact cues
3) immediate next checks`;

  const outputGuidance =
    compacted.kind === 'trace'
      ? `Output guidance:
- Start with "TL;DR:" as one short sentence.
- Then use whatever structure best fits the data (short paragraph and/or bullets).
- Focus on why this matters for SRE outcomes: availability, latency/performance, and operational risk.
- Mention user impact and urgency when inferable.
- Keep reasonably concise (typically <= 200 words).`
      : `Output guidance:
- Start with "TL;DR:" as one short sentence.
- Then use whatever structure best fits the data (short paragraph and/or bullets).
- Focus on why this matters for SRE outcomes: availability, latency/performance, and operational risk.
- Mention user impact and urgency when inferable.
- Keep reasonably concise (typically <= 160 words).`;

  const prompt = `${TONE_INSTRUCTIONS[tone]}

${kindInstructions}

${outputGuidance}

Context:
${JSON.stringify(compacted.context, null, 2)}`;

  return {
    system,
    prompt,
    maxOutputTokens: compacted.kind === 'trace' ? 500 : 360,
  };
}
