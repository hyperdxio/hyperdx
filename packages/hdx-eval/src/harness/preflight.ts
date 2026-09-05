import type { McpDefinition, McpKind } from './types';

/**
 * Result of probing a single MCP server for reachability.
 */
export type PreflightResult = {
  mcp: McpKind;
  ok: boolean;
  /** Number of tools the server advertised via `tools/list` (HTTP only). */
  toolCount?: number;
  /** Human-readable failure reason when `ok` is false. */
  error?: string;
};

const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * Parse a JSON-RPC response body that may be either a plain JSON object
 * (Content-Type: application/json) or a Server-Sent Events stream
 * (Content-Type: text/event-stream, one `data: {...}` line per event).
 * The stateless Streamable HTTP transport used by the HyperDX MCP server
 * replies with SSE, so we extract the first `data:` payload.
 */
function parseJsonRpcBody(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  // SSE framing: find the first `data:` line and parse it.
  for (const line of trimmed.split('\n')) {
    const m = line.match(/^data:\s*(.*)$/);
    if (m && m[1]) return JSON.parse(m[1]);
  }
  throw new Error('no JSON-RPC payload found in response body');
}

async function postJsonRpc(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs: number,
): Promise<{ status: number; body: string; mcpSessionId: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The Streamable HTTP transport requires the client to accept both.
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      body,
      mcpSessionId: res.headers.get('mcp-session-id'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a single HTTP MCP server: run the `initialize` handshake and then
 * `tools/list`, confirming the server is reachable and actually serving
 * tools. stdio MCPs are reported as `ok` without probing (they are spawned
 * per-run by Claude Code and cannot be probed out-of-band here).
 */
export async function probeMcp(
  mcp: McpKind,
  def: McpDefinition,
  timeoutMs = 10_000,
): Promise<PreflightResult> {
  if (def.type !== 'http') {
    // stdio servers are launched by Claude Code itself; nothing to probe.
    return { mcp, ok: true };
  }

  const headers = def.headers ?? {};
  try {
    const init = await postJsonRpc(
      def.url,
      headers,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'hdx-eval-preflight', version: '1.0' },
        },
      },
      timeoutMs,
    );

    if (init.status < 200 || init.status >= 300) {
      return {
        mcp,
        ok: false,
        error: `initialize returned HTTP ${init.status} (is the API server on this slot running?)`,
      };
    }

    let initResult: unknown;
    try {
      initResult = parseJsonRpcBody(init.body);
    } catch (e) {
      return {
        mcp,
        ok: false,
        error: `initialize response was not valid JSON-RPC: ${(e as Error).message}`,
      };
    }
    if ((initResult as { error?: unknown })?.error) {
      return {
        mcp,
        ok: false,
        error: `initialize returned a JSON-RPC error: ${JSON.stringify(
          (initResult as { error: unknown }).error,
        )}`,
      };
    }

    // Some transports require the session id from initialize on later calls.
    const sessionHeaders = init.mcpSessionId
      ? { ...headers, 'mcp-session-id': init.mcpSessionId }
      : headers;

    const list = await postJsonRpc(
      def.url,
      sessionHeaders,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      timeoutMs,
    );
    if (list.status < 200 || list.status >= 300) {
      return {
        mcp,
        ok: false,
        error: `tools/list returned HTTP ${list.status}`,
      };
    }

    let toolCount: number | undefined;
    try {
      const parsed = parseJsonRpcBody(list.body) as {
        result?: { tools?: unknown[] };
      };
      toolCount = parsed.result?.tools?.length;
    } catch {
      // tools/list body unparseable — treat as zero tools below.
      toolCount = undefined;
    }

    if (!toolCount || toolCount === 0) {
      return {
        mcp,
        ok: false,
        toolCount: toolCount ?? 0,
        error:
          'server is reachable but advertised 0 tools via tools/list ' +
          '(the agent would have nothing to call)',
      };
    }

    return { mcp, ok: true, toolCount };
  } catch (e) {
    const err = e as Error;
    const reason =
      err.name === 'AbortError'
        ? `no response within ${timeoutMs}ms`
        : err.message;
    return {
      mcp,
      ok: false,
      error: `could not connect to ${def.url}: ${reason} (is the API server on this slot running?)`,
    };
  }
}

/**
 * Probe every MCP that a run batch will use. Returns the per-MCP results so
 * the caller can abort the batch before spawning any agents when a server is
 * unreachable — preventing an entire suite of silent zero-tool-call runs that
 * look like (bad) scores but actually reflect a dead server.
 */
export async function preflightMcps(
  entries: Array<{ mcp: McpKind; def: McpDefinition }>,
  timeoutMs = 10_000,
): Promise<PreflightResult[]> {
  return Promise.all(
    entries.map(({ mcp, def }) => probeMcp(mcp, def, timeoutMs)),
  );
}
