import {
  readBoundedBody,
  ResponseTooLargeError,
} from '@/utils/readBoundedBody';

const MAX = 4 * 1024;

const streamOf = (
  pull: (controller: ReadableStreamDefaultController<Uint8Array>) => void,
  onCancel: () => void,
) =>
  new ReadableStream<Uint8Array>({
    pull,
    cancel() {
      onCancel();
    },
  });

describe('readBoundedBody', () => {
  it('refuses a declared Content-Length over the cap without reading the body', async () => {
    let cancelled = false;
    const body = streamOf(
      c => c.enqueue(new TextEncoder().encode('{')),
      () => (cancelled = true),
    );
    const resp = new Response(body, {
      headers: { 'content-length': String(MAX + 1) },
    });

    await expect(readBoundedBody(resp, MAX)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(cancelled).toBe(true);
    expect(resp.bodyUsed).toBe(true);
  });

  it('stops reading an undeclared-length body at the cap', async () => {
    const chunk = new Uint8Array(1024).fill(0x20);
    let pulled = 0;
    let cancelled = false;
    const body = streamOf(
      c => {
        pulled++;
        c.enqueue(chunk);
      },
      () => (cancelled = true),
    );

    await expect(
      readBoundedBody(new Response(body), MAX),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancelled).toBe(true);
    // One chunk per KB, plus the one that crossed the cap and the stream's
    // read-ahead.
    expect(pulled).toBeLessThanOrEqual(MAX / chunk.byteLength + 2);
  });

  it('joins a chunked body under the cap into one string', async () => {
    const text = 'héllo wörld';
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 3));
        c.enqueue(bytes.slice(3));
        c.close();
      },
    });

    await expect(readBoundedBody(new Response(body), MAX)).resolves.toBe(text);
  });

  it('returns an empty string for a response with no body', async () => {
    await expect(
      readBoundedBody(new Response(null, { status: 204 }), MAX),
    ).resolves.toBe('');
  });
});
