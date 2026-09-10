import http from 'http';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

// Use the real proxy instead of the blanket mock in jest.setup.ts; the int
// jest config transpiles it (see jest.int.config.js).
jest.unmock('http-proxy-middleware');

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

/**
 * Pins /clickhouse-proxy body forwarding: text/plain re-injection and the
 * raw-stream passthrough of multipart/form-data bodies, which
 * `@clickhouse/client-web` emits when query params exceed its URL budget
 * (regression context: ClickHouse support-escalation #8482).
 *
 * Known-latent cases (charset-suffixed JSON, urlencoded) are not covered;
 * tracked in https://github.com/hyperdxio/hyperdx/issues/2942.
 */
describe('clickhouse-proxy body forwarding', () => {
  const server = getServer();

  let upstream: http.Server;
  let upstreamUrl: string;
  let captured: CapturedRequest[] = [];
  /** Set by a test to take over the upstream response (e.g. to stream it). */
  let streamingHandler:
    | ((req: http.IncomingMessage, res: http.ServerResponse) => void)
    | undefined;

  beforeAll(async () => {
    await server.start();

    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        captured.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        if (streamingHandler) {
          streamingHandler(req, res);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
      });
    });
    await new Promise<void>(resolve => upstream.listen(0, resolve));
    const address = upstream.address();
    if (address == null || typeof address === 'string') {
      throw new Error('Expected upstream server to listen on a TCP port');
    }
    upstreamUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    captured = [];
    streamingHandler = undefined;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      upstream.close(err => (err ? reject(err) : resolve())),
    );
    await server.stop();
  });

  const createConnection = async (teamId: string) => {
    const connection = await Connection.create({
      team: teamId,
      name: 'Upstream Echo',
      host: upstreamUrl,
      username: 'default',
      password: '',
    });
    return connection._id.toString();
  };

  it('forwards a text/plain SQL body verbatim', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    const sql = 'SELECT count() FROM system.tables FORMAT JSON';
    await agent
      .post('/clickhouse-proxy/?query_id=test-text')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'text/plain')
      .send(sql)
      .expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body.toString()).toBe(sql);
    // Connection credentials are attached server-side.
    expect(captured[0].headers['x-clickhouse-user']).toBe('default');
  });

  it('forwards a large multipart/form-data body byte-for-byte (unparsed stream passthrough)', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    // Mirror the client's multipart output: a `query` part plus one
    // `param_*` part per bound parameter, past the 4096-byte URL budget.
    const boundary = '----clickhouse-js-test-boundary';
    const parts: string[] = [
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="query"\r\n\r\n` +
        `SELECT Key FROM rollup WHERE Key IN ({p0:String}) FORMAT JSON\r\n`,
    ];
    for (let i = 0; i < 120; i++) {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="param_HYPERDX_PARAM_${i}"\r\n\r\n` +
          `some.rather.long.map.attribute.key.number.${i}\r\n`,
      );
    }
    parts.push(`--${boundary}--\r\n`);
    const body = parts.join('');
    expect(Buffer.byteLength(body)).toBeGreaterThan(4096);

    await agent
      .post('/clickhouse-proxy/?query_id=test-multipart')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(body)
      .expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].headers['content-type']).toBe(
      `multipart/form-data; boundary=${boundary}`,
    );
    expect(captured[0].body.toString()).toBe(body);
    expect(captured[0].headers['content-length']).toBe(
      String(Buffer.byteLength(body)),
    );
  });

  /**
   * ClickHouse streams query progress as its own tiny NDJSON lines, which the
   * global `compression()` middleware would otherwise hold in zlib's input
   * buffer until enough bytes accumulate.
   *
   * The upstream here refuses to finish the response until the client has seen
   * its first chunk, so a proxy that buffers cannot complete this request at
   * all — the test fails by timing out rather than by a timing assertion.
   */
  it('streams each upstream chunk to the client instead of buffering', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    let onFirstChunkSeen: () => void = () => {};
    const firstChunkSeen = new Promise<void>(resolve => {
      onFirstChunkSeen = resolve;
    });

    streamingHandler = async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(`{"progress":{"read_rows":"1"}}\n`);
      await firstChunkSeen;
      res.write(`{"row":{"n":1}}\n`);
      res.end();
    };

    const body = await new Promise<string>((resolve, reject) => {
      const received: string[] = [];
      void agent
        .post('/clickhouse-proxy/?query_id=test-streaming')
        .set('x-hyperdx-connection-id', connectionId)
        .set('Content-Type', 'text/plain')
        .send('SELECT 1 FORMAT JSONEachRowWithProgress')
        .buffer(false)
        .parse((res, cb) => {
          res.on('data', (chunk: Buffer) => {
            received.push(chunk.toString());
            onFirstChunkSeen();
          });
          res.on('error', cb);
          res.on('end', () => cb(null, received.join('')));
        })
        .end((err, res) => (err ? reject(err) : resolve(res.body)));
    });

    expect(body).toBe('{"progress":{"read_rows":"1"}}\n{"row":{"n":1}}\n');
  }, 10_000);

  /**
   * Once a streamed response is in flight the headers are already sent, so the
   * proxy's error handler cannot write a 500 — attempting to would throw
   * ERR_HTTP_HEADERS_SENT inside an event listener and take down the process.
   * The request must fail cleanly instead, and the API must stay up.
   */
  it('survives an upstream failure after the response has started streaming', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    let onFirstChunkSeen: () => void = () => {};
    const firstChunkSeen = new Promise<void>(resolve => {
      onFirstChunkSeen = resolve;
    });

    streamingHandler = async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(`{"progress":{"read_rows":"1"}}\n`);
      await firstChunkSeen;
      // Kill the upstream connection mid-body.
      res.socket?.destroy();
    };

    await expect(
      new Promise((resolve, reject) => {
        void agent
          .post('/clickhouse-proxy/?query_id=test-midstream-failure')
          .set('x-hyperdx-connection-id', connectionId)
          .set('Content-Type', 'text/plain')
          .send('SELECT 1 FORMAT JSONEachRowWithProgress')
          .buffer(false)
          .parse((res, cb) => {
            res.on('data', () => onFirstChunkSeen());
            res.on('error', cb);
            res.on('end', () => cb(null, null));
          })
          .end((err, res) => (err ? reject(err) : resolve(res)));
      }),
    ).rejects.toBeDefined();

    // The API is still serving, i.e. the error handler did not throw.
    await agent.get('/health').expect(200);
  }, 10_000);

  it('rejects requests without a connection id header', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent
      .post('/clickhouse-proxy/?query_id=test-no-conn')
      .set('Content-Type', 'text/plain')
      .send('SELECT 1')
      .expect(400);

    expect(captured).toHaveLength(0);
  });
});
