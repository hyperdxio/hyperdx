/** Thrown by readBoundedBody when a response is larger than its cap. */
export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeds ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads a fetch Response body as text without ever holding more than
 * `maxBytes` of it. A declared Content-Length over the cap is refused before
 * any of the body is read; an undeclared (chunked) body is read until the cap
 * and then cancelled. Use it for bodies from hosts we do not control, where
 * `resp.text()` / `resp.json()` would buffer whatever the server sends.
 */
export async function readBoundedBody(
  resp: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(resp.headers.get('content-length'));
  if (declared > maxBytes) {
    await resp.body?.cancel();
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!resp.body) return '';

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
