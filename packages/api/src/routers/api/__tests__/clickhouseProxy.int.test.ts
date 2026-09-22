import { buildLogComment } from '@hyperdx/common-utils/dist/clickhouse';
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
 * Pins what /clickhouse-proxy forwards upstream: text/plain re-injection, the
 * raw-stream passthrough of multipart/form-data bodies, which
 * `@clickhouse/client-web` emits when query params exceed its URL budget
 * (regression context: ClickHouse support-escalation #8482), and the
 * decode/re-encode the query string goes through in `pathRewrite`.
 *
 * Known-latent cases (charset-suffixed JSON, urlencoded) are not covered;
 * tracked in https://github.com/hyperdxio/hyperdx/issues/2942.
 */
describe('clickhouse-proxy forwarding', () => {
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

  // The browser client ships `log_comment` as a URL query param, and
  // pathRewrite fully decodes the query string (sanitizeUrl) before
  // re-encoding it with `searchParams.toString()`. Breaking that round trip
  // fails every browser query, not just the attribution tag - which is why
  // `buildLogComment` allowlists the characters it emits.
  it('preserves the attribution query params through the path rewrite', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    const logComment = buildLogComment({
      surface: 'dashboard',
      dashboard: 'my dashboard 1',
      tile: 'tile-42',
      label: 'a/b:c_d.e',
    });
    if (logComment == null) throw new Error('Expected a log_comment payload');

    const queryId = 'hdx-dashboard-0e0d1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    await agent
      .post(
        `/clickhouse-proxy/?query_id=${queryId}&log_comment=${encodeURIComponent(logComment)}`,
      )
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'text/plain')
      .send('SELECT 1 FORMAT JSON')
      .expect(200);

    expect(captured).toHaveLength(1);
    const forwarded = new URL(captured[0].url ?? '', 'http://localhost');
    expect(forwarded.searchParams.get('query_id')).toBe(queryId);
    expect(forwarded.searchParams.get('log_comment')).toBe(logComment);
    expect(JSON.parse(forwarded.searchParams.get('log_comment') ?? '')).toEqual(
      {
        v: 1,
        surface: 'dashboard',
        dashboard: 'my dashboard 1',
        tile: 'tile-42',
        label: 'a/b:c_d.e',
      },
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
