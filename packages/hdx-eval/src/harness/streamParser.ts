/**
 * Parser for `claude -p --output-format stream-json` event lines.
 * Tolerant of unknown event shapes — passes through as Unknown.
 */

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type SystemInitEvent = {
  kind: 'system_init';
  sessionId?: string;
  model?: string;
  tools?: { name: string; description?: string }[];
  raw: unknown;
};

export type AssistantMessageEvent = {
  kind: 'assistant_message';
  content: unknown[];
  usage?: Usage;
  raw: unknown;
};

export type UserMessageEvent = {
  kind: 'user_message';
  content: unknown[];
  raw: unknown;
};

export type ResultEvent = {
  kind: 'result';
  subtype?: string;
  isError: boolean;
  durationMs?: number;
  totalCostUsd?: number;
  usage?: Usage;
  resultText?: string;
  raw: unknown;
};

export type UnknownEvent = {
  kind: 'unknown';
  type?: string;
  raw: unknown;
};

export type ParsedEvent =
  | SystemInitEvent
  | AssistantMessageEvent
  | UserMessageEvent
  | ResultEvent
  | UnknownEvent;

export function parseStreamLine(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : undefined;

  if (type === 'system' && obj.subtype === 'init') {
    return {
      kind: 'system_init',
      sessionId:
        typeof obj.session_id === 'string' ? obj.session_id : undefined,
      model: typeof obj.model === 'string' ? obj.model : undefined,
      tools: Array.isArray(obj.tools)
        ? (obj.tools as unknown[])
            .map(toToolDescriptor)
            .filter((t): t is { name: string } => t !== null)
        : undefined,
      raw,
    };
  }

  if (type === 'assistant') {
    const message = (obj.message ?? {}) as Record<string, unknown>;
    return {
      kind: 'assistant_message',
      content: Array.isArray(message.content)
        ? (message.content as unknown[])
        : [],
      usage: message.usage as Usage | undefined,
      raw,
    };
  }

  if (type === 'user') {
    const message = (obj.message ?? {}) as Record<string, unknown>;
    return {
      kind: 'user_message',
      content: Array.isArray(message.content)
        ? (message.content as unknown[])
        : [],
      raw,
    };
  }

  if (type === 'result') {
    return {
      kind: 'result',
      subtype: typeof obj.subtype === 'string' ? obj.subtype : undefined,
      isError: obj.is_error === true,
      durationMs:
        typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined,
      totalCostUsd:
        typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined,
      usage: obj.usage as Usage | undefined,
      resultText: typeof obj.result === 'string' ? obj.result : undefined,
      raw,
    };
  }

  return { kind: 'unknown', type, raw };
}

function toToolDescriptor(
  v: unknown,
): { name: string; description?: string } | null {
  if (typeof v === 'string') return { name: v };
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.name === 'string') {
      return {
        name: obj.name,
        description:
          typeof obj.description === 'string' ? obj.description : undefined,
      };
    }
  }
  return null;
}

/**
 * Splits a chunk of streamed bytes into complete JSON-line events plus a
 * remainder. Preserves the trailing partial line for the next chunk.
 */
export function chunkToLines(
  buffer: string,
  chunk: string,
): { events: string[]; remainder: string } {
  const combined = buffer + chunk;
  const parts = combined.split('\n');
  const remainder = parts.pop() ?? '';
  return { events: parts.filter(p => p.length > 0), remainder };
}
