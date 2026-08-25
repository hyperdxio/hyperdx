import {
  createRrwebChunkAssembler,
  RRWebAssemblerErrorInfo,
  RRWebStreamRow,
} from '@/utils/rrwebChunkAssembler';

/** Splits a stringified event into `total` chunk rows, recorder-style. */
function chunkRows(
  event: object,
  total: number,
  eventId: number,
): RRWebStreamRow[] {
  const body = JSON.stringify(event);
  const size = Math.ceil(body.length / total);
  return Array.from({ length: total }, (_, i) => ({
    b: body.slice(i * size, (i + 1) * size),
    ck: String(i + 1), // ClickHouse map values come back as strings
    tcks: String(total),
    ev: String(eventId),
  }));
}

function makeAssembler() {
  const events: any[] = [];
  const errors: RRWebAssemblerErrorInfo[] = [];
  const assembler = createRrwebChunkAssembler({
    onEvent: event => events.push(event),
    onError: (_error, info) => errors.push(info),
  });
  return { assembler, events, errors };
}

describe('createRrwebChunkAssembler', () => {
  it('parses unchunked events directly', () => {
    const { assembler, events, errors } = makeAssembler();
    assembler.push({
      b: '{"type":4,"timestamp":1}',
      ck: '1',
      tcks: '1',
      ev: '1',
    });
    // legacy rows without rr-web attributes at all
    assembler.push({ b: '{"type":3,"timestamp":2}', ck: '', tcks: '', ev: '' });
    assembler.end();

    expect(events).toEqual([
      { type: 4, timestamp: 1 },
      { type: 3, timestamp: 2 },
    ]);
    expect(errors).toEqual([]);
  });

  it('reassembles multi-chunk events arriving in order', () => {
    const { assembler, events, errors } = makeAssembler();
    const event = { type: 2, timestamp: 3, data: { text: 'x'.repeat(500) } };
    for (const row of chunkRows(event, 3, 7)) {
      assembler.push(row);
    }
    assembler.end();

    expect(events).toEqual([event]);
    expect(errors).toEqual([]);
  });

  it('reassembles multi-chunk events arriving out of order', () => {
    // The regression from hyperdxio/hyperdx#2569: all chunks of an event
    // share one timestamp, so ClickHouse may return them in any order.
    const { assembler, events, errors } = makeAssembler();
    const event = { type: 2, timestamp: 4, data: { text: 'y'.repeat(500) } };
    const rows = chunkRows(event, 4, 9);
    for (const row of [rows[2], rows[0], rows[3], rows[1]]) {
      assembler.push(row);
    }
    assembler.end();

    expect(events).toEqual([event]);
    expect(errors).toEqual([]);
  });

  it('sorts chunk indexes numerically, not lexicographically', () => {
    const { assembler, events, errors } = makeAssembler();
    const event = { type: 2, timestamp: 5, data: { text: 'z'.repeat(900) } };
    // 12 chunks: lexicographic ordering would put "10" before "2"
    const rows = chunkRows(event, 12, 11);
    for (const row of [...rows].reverse()) {
      assembler.push(row);
    }
    assembler.end();

    expect(events).toEqual([event]);
    expect(errors).toEqual([]);
  });

  it('reassembles interleaved chunks of different events', () => {
    const { assembler, events, errors } = makeAssembler();
    const eventA = { type: 2, timestamp: 6, data: { text: 'a'.repeat(300) } };
    const eventB = { type: 3, timestamp: 6, data: { text: 'b'.repeat(300) } };
    const [a1, a2] = chunkRows(eventA, 2, 1);
    const [b1, b2] = chunkRows(eventB, 2, 2);
    for (const row of [a1, b1, a2, b2]) {
      assembler.push(row);
    }
    assembler.end();

    expect(events).toEqual([eventA, eventB]);
    expect(errors).toEqual([]);
  });

  it('reports a parse error and keeps processing subsequent events', () => {
    const { assembler, events, errors } = makeAssembler();
    assembler.push({ b: '{"type":2,"corrupt', ck: '1', tcks: '2', ev: '1' });
    assembler.push({ b: 'ed"::::', ck: '2', tcks: '2', ev: '1' });
    assembler.push({
      b: '{"type":3,"timestamp":9}',
      ck: '1',
      tcks: '1',
      ev: '2',
    });
    assembler.end();

    expect(events).toEqual([{ type: 3, timestamp: 9 }]);
    expect(errors).toEqual([
      expect.objectContaining({
        reason: 'parse-error',
        eventId: 1,
        chunksReceived: 2,
        totalChunks: 2,
      }),
    ]);
  });

  it('drops a stale incomplete event when its id is reused', () => {
    // The rr-web.event counter resets on page reload, so an id can recur.
    const { assembler, events, errors } = makeAssembler();
    const event = { type: 2, timestamp: 10, data: { text: 'c'.repeat(300) } };
    const [stale1] = chunkRows({ type: 2, timestamp: 1 }, 2, 5);
    const [fresh1, fresh2] = chunkRows(event, 2, 5);
    assembler.push(stale1); // never completed
    assembler.push(fresh1); // same ev + ck as stale1 -> new event
    assembler.push(fresh2);
    assembler.end();

    expect(events).toEqual([event]);
    expect(errors).toEqual([
      expect.objectContaining({ reason: 'duplicate-chunk', eventId: 5 }),
    ]);
  });

  it('reports incomplete events at end of stream', () => {
    const { assembler, events, errors } = makeAssembler();
    const [first] = chunkRows({ type: 2, timestamp: 11 }, 3, 4);
    assembler.push(first);
    assembler.end();

    expect(events).toEqual([]);
    expect(errors).toEqual([
      expect.objectContaining({
        reason: 'incomplete-event',
        eventId: 4,
        chunksReceived: 1,
        totalChunks: 3,
      }),
    ]);
  });

  it('evicts the oldest pending event when the buffer overflows', () => {
    const { assembler, events, errors } = makeAssembler();
    // 22 chunked events, each missing its final chunk
    for (let i = 1; i <= 22; i++) {
      const [first] = chunkRows({ type: 3, timestamp: i }, 2, i);
      assembler.push(first);
    }

    expect(events).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toEqual(
      expect.objectContaining({ reason: 'buffer-overflow', eventId: 1 }),
    );
  });

  it('handles numeric attribute values as well as strings', () => {
    const { assembler, events, errors } = makeAssembler();
    const event = { type: 2, timestamp: 12, data: { text: 'd'.repeat(300) } };
    const body = JSON.stringify(event);
    const half = Math.ceil(body.length / 2);
    assembler.push({ b: body.slice(0, half), ck: 1, tcks: 2, ev: 3 });
    assembler.push({ b: body.slice(half), ck: 2, tcks: 2, ev: 3 });
    assembler.end();

    expect(events).toEqual([event]);
    expect(errors).toEqual([]);
  });

  it('keeps separate instances fully isolated (concurrent streams)', () => {
    // DOMPlayer creates one assembler per stream. A replaced stream is not
    // reliably cancelled, so an old stream's pushes and end() can interleave
    // with the new stream's — including for identical query parameters
    // (switching away from a session and back mid-load). Instance identity,
    // not any shared key, is what isolates their buffers.
    const events: any[] = [];
    const errors: RRWebAssemblerErrorInfo[] = [];
    const callbacks = {
      onEvent: (event: any) => events.push(event),
      onError: (_error: unknown, info: RRWebAssemblerErrorInfo) =>
        errors.push(info),
    };
    const oldStream = createRrwebChunkAssembler(callbacks);
    const newStream = createRrwebChunkAssembler(callbacks);

    const event = { type: 2, timestamp: 1, data: { text: 'e'.repeat(300) } };
    const [c1, c2] = chunkRows(event, 2, 1);

    oldStream.push(c1);
    newStream.push(c1);
    // The old stream finishing must not flush or drop the new stream's
    // partially assembled event.
    oldStream.end();
    newStream.push(c2);
    newStream.end();

    expect(events).toEqual([event]);
    expect(errors).toEqual([
      expect.objectContaining({ reason: 'incomplete-event', eventId: 1 }),
    ]);
  });
});
