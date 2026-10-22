import { buildLogComment } from '@hyperdx/common-utils/dist/clickhouse';
import http from 'http';
import { gzipSync } from 'zlib';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import logger from '@/utils/logger';

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
 * Pins what /clickhouse-proxy forwards upstream: captured parser bytes with
 * valid framing, the raw-stream passthrough of multipart/form-data bodies, which
 * `@clickhouse/client-web` emits when query params exceed its URL budget
 * (regression context: ClickHouse support-escalation #8482), and the
 * decode/re-encode the query string goes through in `pathRewrite`.
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
    upstream.closeAllConnections();
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

  it.each(['application/json', 'application/json; charset=utf-8'])(
    'preserves %s bytes and Content-Length',
    async contentType => {
      const { agent, team } = await getLoggedInAgent(server);
      const connectionId = await createConnection(team._id.toString());
      const body = {
        query: "SELECT '東京 🍰' FORMAT JSON",
        param_name: 'café',
      };
      const original = JSON.stringify(body, null, 2);
      expect(Buffer.byteLength(original)).toBeGreaterThan(original.length);

      await agent
        .post('/clickhouse-proxy/?query_id=test-json')
        .set('x-hyperdx-connection-id', connectionId)
        .set('Content-Type', contentType)
        .send(original)
        .timeout({ response: 5000, deadline: 10000 })
        .expect(200);

      expect(captured).toHaveLength(1);
      expect(captured[0].body).toEqual(Buffer.from(original));
      expect(captured[0].headers['content-type']).toBe(contentType);
      expect(captured[0].headers['content-length']).toBe(
        String(Buffer.byteLength(original)),
      );
      expect(captured[0].headers['transfer-encoding']).toBeUndefined();
    },
  );

  it('preserves parsed UTF-16LE JSON bytes and charset', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());
    const body = { query: "SELECT '東京 🍰' FORMAT JSON" };
    const original = Buffer.from(JSON.stringify(body, null, 2), 'utf16le');

    const proxyRequest = agent
      .post('/clickhouse-proxy/?query_id=test-utf16-json')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/json; charset=utf-16le')
      .set('Content-Length', String(original.length))
      .timeout({ response: 5000, deadline: 10000 });
    proxyRequest.write(original);
    await proxyRequest.expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body).toEqual(original);
    expect(captured[0].headers['content-type']).toBe(
      'application/json; charset=utf-16le',
    );
    expect(captured[0].headers['content-length']).toBe(String(original.length));
    expect(captured[0].headers['content-encoding']).toBeUndefined();
  });

  it('forwards parsed gzip JSON without the original content encoding', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());
    const body = { query: "SELECT 'café' FORMAT JSON" };
    const serialized = Buffer.from(JSON.stringify(body, null, 2));
    const original = gzipSync(serialized);

    const proxyRequest = agent
      .post('/clickhouse-proxy/?query_id=test-gzip-json')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Content-Encoding', 'gzip')
      .set('Content-Length', String(original.length))
      .timeout({ response: 5000, deadline: 10000 });
    proxyRequest.write(original);
    await proxyRequest.expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body).toEqual(serialized);
    expect(captured[0].headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(captured[0].headers['content-length']).toBe(
      String(serialized.length),
    );
    expect(captured[0].headers['content-encoding']).toBeUndefined();
  });

  it.each([
    'application/x-www-form-urlencoded',
    'application/x-www-form-urlencoded; charset=utf-8',
  ])('preserves %s bytes and repeated form keys', async contentType => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());
    const original =
      'query=SELECT%20%27caf%C3%A9%27&param=first&param=second%20value&empty=&literal=%2B%26%3D';
    const entries = [
      ['query', "SELECT 'café'"],
      ['param', 'first'],
      ['param', 'second value'],
      ['empty', ''],
      ['literal', '+&='],
    ];

    await agent
      .post('/clickhouse-proxy/?query_id=test-urlencoded')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', contentType)
      .send(original)
      .timeout({ response: 5000, deadline: 10000 })
      .expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body.toString()).toBe(original);
    expect([...new URLSearchParams(captured[0].body.toString())]).toEqual(
      entries,
    );
    expect(captured[0].headers['content-type']).toBe(contentType);
    expect(captured[0].headers['content-length']).toBe(
      String(Buffer.byteLength(original)),
    );
  });

  it('keeps chunked framing when forwarding captured JSON bytes', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());
    const body = { query: "SELECT 'café' FORMAT JSON" };
    const original = JSON.stringify(body, null, 2);
    const proxyRequest = agent
      .post('/clickhouse-proxy/?query_id=test-chunked-json')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Transfer-Encoding', 'chunked')
      .timeout({ response: 5000, deadline: 10000 });

    proxyRequest.write(original.slice(0, 10));
    proxyRequest.write(original.slice(10));
    await proxyRequest.expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body.toString()).toBe(original);
    expect(captured[0].headers['transfer-encoding']).toBe('chunked');
    expect(captured[0].headers['content-length']).toBeUndefined();
  });

  it.each(['/clickhouse-proxy/', '/CLICKHOUSE-PROXY/'])(
    'preserves JSON number literals and duplicate keys on %s',
    async route => {
      const { agent, team } = await getLoggedInAgent(server);
      const connectionId = await createConnection(team._id.toString());
      const original =
        '{"id":9007199254740993,"value":1.0,"value":1e2,"query":"SELECT 1"}';

      await agent
        .post(`${route}?query_id=test-json-fidelity`)
        .set('x-hyperdx-connection-id', connectionId)
        .set('Content-Type', 'application/json; charset=utf-8')
        .send(original)
        .timeout({ response: 5000, deadline: 10000 })
        .expect(200);

      expect(captured).toHaveLength(1);
      expect(captured[0].body).toEqual(Buffer.from(original));
    },
  );

  it('preserves an empty JSON body for query-string SQL', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    await agent
      .post('/clickhouse-proxy/?query=SELECT+1')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/json')
      .set('Content-Length', '0')
      .timeout({ response: 5000, deadline: 10000 })
      .expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body).toEqual(Buffer.alloc(0));
    expect(captured[0].headers['content-length']).toBe('0');
  });

  it('preserves bytes under duplicate charset parameters', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());
    const contentType = 'application/json; charset=utf-8; charset=utf-16le';
    const original = Buffer.from('{"query":"SELECT 1"}', 'utf16le');
    const proxyRequest = agent
      .post('/clickhouse-proxy/?query_id=test-duplicate-charset')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', contentType)
      .set('Content-Length', String(original.length))
      .timeout({ response: 5000, deadline: 10000 });
    proxyRequest.write(original);
    await proxyRequest.expect(200);

    expect(captured).toHaveLength(1);
    expect(captured[0].body).toEqual(original);
    expect(captured[0].headers['content-type']).toBe(contentType);
    expect(captured[0].headers['content-length']).toBe(String(original.length));
  });

  it('still rejects invalid JSON before forwarding', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const connectionId = await createConnection(team._id.toString());

    await agent
      .post('/clickhouse-proxy/')
      .set('x-hyperdx-connection-id', connectionId)
      .set('Content-Type', 'application/json')
      .send('{invalid')
      .expect(400);

    expect(captured).toHaveLength(0);
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
    const body = Buffer.concat([
      Buffer.from(parts.join('')),
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="bytes.bin"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from([0x00, 0xff, 0x80, 0x0d, 0x0a]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    expect(Buffer.byteLength(body)).toBeGreaterThan(4096);

    const loggerError = jest.spyOn(logger, 'error');
    try {
      await agent
        .post('/clickhouse-proxy/?query_id=test-multipart')
        .set('x-hyperdx-connection-id', connectionId)
        .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
        .send(body)
        .timeout({ response: 5000, deadline: 10000 })
        .expect(200);

      expect(captured).toHaveLength(1);
      expect(captured[0].headers['content-type']).toBe(
        `multipart/form-data; boundary=${boundary}`,
      );
      expect(captured[0].body).toEqual(body);
      expect(captured[0].headers['content-length']).toBe(
        String(Buffer.byteLength(body)),
      );
      expect(loggerError).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
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
