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
