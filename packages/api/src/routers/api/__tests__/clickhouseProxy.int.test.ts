import http from 'http';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

// jest.setup.ts blanket-mocks http-proxy-middleware (ESM-only) for suites that
// don't touch it; this suite exercises the real proxy, which the int jest
// config makes loadable by transpiling it (see jest.int.config.js).
jest.unmock('http-proxy-middleware');

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

/**
 * Verifies the /clickhouse-proxy route forwards request bodies to the upstream
 * ClickHouse host byte-for-byte, across every content type the web client
 * emits.
 *
 * Regression context (ClickHouse support-escalation #8482): when
 * `@clickhouse/client-web` promotes oversized query params to a
 * multipart/form-data body (`use_multipart_params_auto`), no express body
 * parser consumes the stream and the proxy used to attempt
 * `proxyReq.write(req.body)` with the unparsed `{}` placeholder — throwing,
 * swallowing the error, and (depending on the proxy internals) corrupting the
 * upstream request. Filter sidebar facet queries then failed silently.
 */
describe('clickhouse-proxy body forwarding', () => {
  const server = getServer();

  let upstream: http.Server;
  let upstreamUrl: string;
  let captured: CapturedRequest[] = [];

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
    expect(captured[0].headers['content-length']).toBe(
      String(Buffer.byteLength(sql)),
    );
    // Connection credentials are attached server-side.
    expect(captured[0].headers['x-clickhouse-user']).toBe('default');
  });

  it('forwards a large multipart/form-data body byte-for-byte (unparsed stream passthrough)', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    // Mirror @clickhouse/client-web's use_multipart_params_auto output: a
    // `query` part plus one `param_*` part per bound parameter, well past the
    // 4096-byte URL budget that triggers the multipart promotion.
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

  it('re-serializes an application/json body with a charset suffix', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    const payload = { query: 'SELECT 1', nested: { a: 1 } };
    await agent
      .post('/clickhouse-proxy/?query_id=test-json')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify(payload))
      .expect(200);

    expect(captured).toHaveLength(1);
    const forwarded = captured[0].body.toString();
    expect(JSON.parse(forwarded)).toEqual(payload);
    // Content-Length must match the re-serialized bytes actually sent, not
    // the original request's header.
    expect(captured[0].headers['content-length']).toBe(
      String(Buffer.byteLength(forwarded)),
    );
  });

  it('re-serializes an application/x-www-form-urlencoded body', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    await agent
      .post('/clickhouse-proxy/?query_id=test-urlencoded')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('query=SELECT+1&param_foo=bar')
      .expect(200);

    expect(captured).toHaveLength(1);
    const forwarded = new URLSearchParams(captured[0].body.toString());
    expect(forwarded.get('query')).toBe('SELECT 1');
    expect(forwarded.get('param_foo')).toBe('bar');
  });

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
