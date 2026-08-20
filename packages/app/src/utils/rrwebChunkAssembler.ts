/**
 * Reassembles rrweb events from the chunked log records emitted by the
 * HyperDX session recorder.
 *
 * The recorder JSON-stringifies each rrweb event and splits anything larger
 * than ~950KB into multiple log records. Every record carries:
 *   - `rr-web.event` (`ev`): counter identifying the event, shared by all of
 *     its chunks
 *   - `rr-web.chunk` (`ck`): 1-based chunk index within the event
 *   - `rr-web.total-chunks` (`tcks`): number of chunks for the event
 *
 * All chunks of one event share the same log timestamp, so the stream order
 * of chunks is only as reliable as the query's ORDER BY. This assembler
 * buffers chunks per event id and joins them sorted by chunk index, so a
 * replay can never be corrupted by out-of-order or interleaved chunks —
 * which previously scrambled the concatenation, made JSON.parse throw, and
 * silently dropped the event (https://github.com/hyperdxio/hyperdx/issues/2569).
 *
 * ClickHouse returns the attributes as strings (or `''` when absent), so all
 * fields are coerced before use.
 */

export type RRWebStreamRow = {
  /** Body fragment (whole event when unchunked) */
  b: string;
  /** simpleJSONExtractInt(Body, 'type') — only meaningful on the first chunk */
  t?: number | string;
  /** rr-web.chunk — 1-based chunk index */
  ck?: number | string;
  /** rr-web.total-chunks */
  tcks?: number | string;
  /** rr-web.event — event counter shared by all chunks of an event */
  ev?: number | string;
};

export type RRWebAssemblerErrorInfo = {
  reason:
    | 'parse-error'
    | 'incomplete-event'
    | 'duplicate-chunk'
    | 'buffer-overflow';
  eventId?: number;
  chunksReceived: number;
  totalChunks: number;
};

type PendingEvent = {
  totalChunks: number;
  parts: Map<number, string>;
};

/**
 * Max number of chunked events buffered concurrently. With a correctly
 * ordered stream at most one event is pending at a time; the cap only guards
 * against pathological data endlessly growing memory.
 */
const MAX_PENDING_EVENTS = 20;

const toNumber = (value: number | string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function createRrwebChunkAssembler({
  onEvent,
  onError,
}: {
  /** Called with each fully reassembled, parsed rrweb event */
  onEvent: (event: any) => void;
  /** Called when an event had to be dropped */
  onError: (error: unknown, info: RRWebAssemblerErrorInfo) => void;
}) {
  // Insertion-ordered by first-seen chunk, used for overflow eviction
  const pending = new Map<number, PendingEvent>();

  const parseAndEmit = (
    body: string,
    eventId: number | undefined,
    chunksReceived: number,
    totalChunks: number,
  ) => {
    try {
      onEvent(JSON.parse(body));
    } catch (error) {
      onError(error, {
        reason: 'parse-error',
        eventId,
        chunksReceived,
        totalChunks,
      });
    }
  };

  const dropPending = (
    eventId: number,
    entry: PendingEvent,
    reason: RRWebAssemblerErrorInfo['reason'],
  ) => {
    pending.delete(eventId);
    onError(new Error(`rrweb event dropped: ${reason}`), {
      reason,
      eventId,
      chunksReceived: entry.parts.size,
      totalChunks: entry.totalChunks,
    });
  };

  return {
    push(row: RRWebStreamRow): void {
      const totalChunks = toNumber(row.tcks);
      const chunk = toNumber(row.ck);
      const eventId = toNumber(row.ev);

      // Unchunked event — parse directly.
      if (totalChunks <= 1 || chunk === 0) {
        parseAndEmit(row.b, eventId, 1, 1);
        return;
      }

      let entry = pending.get(eventId);
      if (entry != null && entry.parts.has(chunk)) {
        // The event counter resets on page reload, so a colliding id means a
        // new event started before the previous one completed. Drop the
        // incomplete one rather than mixing bodies.
        dropPending(eventId, entry, 'duplicate-chunk');
        entry = undefined;
      }
      if (entry == null) {
        entry = { totalChunks, parts: new Map() };
        pending.set(eventId, entry);
      }
      entry.parts.set(chunk, row.b);

      if (entry.parts.size >= entry.totalChunks) {
        pending.delete(eventId);
        const body = [...entry.parts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, part]) => part)
          .join('');
        parseAndEmit(body, eventId, entry.parts.size, entry.totalChunks);
        return;
      }

      if (pending.size > MAX_PENDING_EVENTS) {
        const oldest = pending.entries().next().value;
        if (oldest != null) {
          const [oldestId, oldestEntry] = oldest;
          dropPending(oldestId, oldestEntry, 'buffer-overflow');
        }
      }
    },

    /** Reports any events still incomplete when the stream ends. */
    end(): void {
      for (const [eventId, entry] of pending) {
        onError(new Error('rrweb event dropped: incomplete-event'), {
          reason: 'incomplete-event',
          eventId,
          chunksReceived: entry.parts.size,
          totalChunks: entry.totalChunks,
        });
      }
      pending.clear();
    },
  };
}

export type RRWebChunkAssembler = ReturnType<typeof createRrwebChunkAssembler>;

/**
 * Keeps one assembler per event stream, keyed by a stream identity string.
 *
 * A replaced stream is not reliably cancelled, so callbacks from an old
 * stream can interleave with its replacement's. Each stream must keep its
 * own assembler for its whole lifetime — a single shared slot would be
 * swapped back and forth by the interleaved callbacks, discarding partially
 * buffered events from both streams.
 */
export function createRrwebAssemblerRegistry(callbacks: {
  onEvent: (event: any) => void;
  onError: (error: unknown, info: RRWebAssemblerErrorInfo) => void;
}) {
  const assemblers = new Map<string, RRWebChunkAssembler>();

  return {
    /** Returns the assembler for a stream, creating it if needed. */
    get(key: string): RRWebChunkAssembler {
      let assembler = assemblers.get(key);
      if (assembler == null) {
        assembler = createRrwebChunkAssembler(callbacks);
        assemblers.set(key, assembler);
      }
      return assembler;
    },

    /** Flushes incomplete-event errors and forgets a finished stream. */
    end(key: string): void {
      assemblers.get(key)?.end();
      assemblers.delete(key);
    },

    /** Drops all streams without reporting (e.g. on unmount). */
    clear(): void {
      assemblers.clear();
    },
  };
}
