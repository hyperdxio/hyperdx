/** Error with an HTTP status code attached for callers to distinguish 404 from other failures. */
export type ApiError = Error & { status?: number };

type CookieJar = Map<string, string>;

type HyperdxConnection = {
  _id: string;
  name: string;
  host: string;
  username: string;
  password?: string;
};

export type HyperdxSource = {
  _id: string;
  id: string;
  name: string;
  kind: 'log' | 'trace' | 'session' | 'metric';
  connection: string;
  from: { databaseName: string; tableName: string };
  timestampValueExpression: string;
  [key: string]: unknown;
};

type MeResponse = {
  id: string;
  email: string;
  accessKey: string;
  team: { _id: string; name: string };
};

export class HyperdxApiClient {
  private cookies: CookieJar = new Map();

  constructor(private readonly apiUrl: string) {}

  private url(path: string): string {
    return `${this.apiUrl.replace(/\/$/, '')}${path}`;
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private absorbSetCookie(res: Response): void {
    // Node's fetch exposes Set-Cookie via getSetCookie() (Node 22+).
    const headers = res.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const list = headers.getSetCookie?.() ?? [];
    for (const raw of list) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.cookies.set(name, value);
    }
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers['Cookie'] = cookie;

    const res = await fetch(this.url(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.absorbSetCookie(res);

    const text = await res.text();
    let parsed: unknown = text;
    if (text && (res.headers.get('content-type') ?? '').includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep as text
      }
    }

    if (res.status >= 400) {
      const snippet =
        typeof parsed === 'string'
          ? parsed.slice(0, 500)
          : JSON.stringify(parsed).slice(0, 500);
      const err = new Error(
        `HyperDX API ${method} ${path} → ${res.status}: ${snippet}`,
      );
      (err as ApiError).status = res.status;
      throw err;
    }
    return { status: res.status, body: parsed as T };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/'), {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async register(
    email: string,
    password: string,
  ): Promise<'created' | 'exists'> {
    const res = await fetch(this.url('/register/password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, confirmPassword: password }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.absorbSetCookie(res);
    if (res.status === 200) return 'created';
    // Existing accounts return 400 with { error: 'invalid' }; treat as 'exists'
    // and let login retry verify the credentials match.
    return 'exists';
  }

  async login(email: string, password: string): Promise<void> {
    const res = await fetch(this.url('/login/password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.absorbSetCookie(res);
    // Passport login redirects to /login?err=authFail on bad credentials.
    // The redirect itself is 3xx (not 4xx), so we have to inspect the
    // Location header to detect failure.
    const location = res.headers.get('location') ?? '';
    if (/err=/.test(location)) {
      throw new Error(
        `HyperDX login failed: passport returned auth-failure redirect to ${location}`,
      );
    }
    if (res.status >= 400) {
      const text = await res.text();
      throw new Error(
        `HyperDX login failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }
  }

  async me(): Promise<MeResponse> {
    const { body } = await this.request<MeResponse>('GET', '/me');
    return body;
  }

  async listConnections(): Promise<HyperdxConnection[]> {
    const { body } = await this.request<HyperdxConnection[]>(
      'GET',
      '/connections',
    );
    return body;
  }

  async createConnection(input: {
    name: string;
    host: string;
    username: string;
    password?: string;
  }): Promise<{ id: string }> {
    const { body } = await this.request<{ id: string }>(
      'POST',
      '/connections',
      input,
    );
    return body;
  }

  async listSources(): Promise<HyperdxSource[]> {
    const { body } = await this.request<HyperdxSource[]>('GET', '/sources');
    return body;
  }

  async createSource(input: Record<string, unknown>): Promise<HyperdxSource> {
    const { body } = await this.request<HyperdxSource>(
      'POST',
      '/sources',
      input,
    );
    return body;
  }

  async deleteSource(id: string): Promise<void> {
    await this.request<unknown>('DELETE', `/sources/${id}`);
  }

  /**
   * Fetch a dashboard via the External API v2 which returns a cleaner shape:
   * - tile `name` is promoted to a top-level field (not buried in config)
   * - config uses `sourceId` (not `source` ObjectId)
   * - select items are restructured with clear field names
   * Uses Bearer auth (accessKey), not cookie auth.
   */
  async getDashboardV2(
    id: string,
    accessKey: string,
  ): Promise<HyperdxDashboard> {
    const res = await fetch(this.url(`/api/v2/dashboards/${id}`), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(
        `GET /api/v2/dashboards/${id} → ${res.status}: ${text.slice(0, 300)}`,
      );
      (err as ApiError).status = res.status;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const err = new Error(
        `GET /api/v2/dashboards/${id} → ${res.status}: non-JSON response: ${text.slice(0, 200)}`,
      );
      (err as ApiError).status = res.status;
      throw err;
    }
    const dashboard = (parsed as Record<string, unknown>)?.data ?? parsed;
    if (
      !dashboard ||
      typeof dashboard !== 'object' ||
      !Array.isArray((dashboard as Record<string, unknown>).tiles)
    ) {
      throw new Error(
        `GET /api/v2/dashboards/${id}: unexpected response shape (missing tiles array)`,
      );
    }
    return dashboard as HyperdxDashboard;
  }

  async deleteDashboard(id: string): Promise<void> {
    await this.request<unknown>('DELETE', `/dashboards/${id}`);
  }

  /**
   * Query a tile and return enriched evidence including sample rows.
   * Used by dashboard inspection to collect data for the LLM judge.
   */
  async queryTileWithEvidence(args: {
    accessKey: string;
    dashboardId: string;
    tileId: string;
    startTime: string;
    endTime: string;
  }): Promise<TileQueryEvidence> {
    const mcpUrl = `${this.apiUrl.replace(/\/$/, '')}/mcp`;

    const rpcBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'clickstack_query_tile',
        arguments: {
          dashboardId: args.dashboardId,
          tileId: args.tileId,
          startTime: args.startTime,
          endTime: args.endTime,
        },
      },
    };

    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        success: false,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        hasData: false,
      };
    }

    // Parse the MCP response — try JSON-RPC first, then SSE
    const content = extractMcpContent(text);
    if (!content) {
      return {
        success: false,
        error: 'Could not parse MCP response',
        hasData: false,
      };
    }
    if (content.isError) {
      return {
        success: false,
        error: content.text.slice(0, 300),
        hasData: false,
      };
    }

    try {
      const inner = JSON.parse(content.text);
      const result = inner.result;
      if (!result) {
        return { success: true, hasData: false };
      }

      let rows: unknown[] = [];
      if (Array.isArray(result)) {
        rows = result;
      } else if (result.data && Array.isArray(result.data)) {
        rows = result.data;
      } else if (typeof result === 'object') {
        for (const v of Object.values(result)) {
          if (Array.isArray(v) && v.length > 0) {
            rows = v as unknown[];
            break;
          }
        }
      }

      const hasData = rows.length > 0;
      let groupCount: number | undefined;
      if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
        const firstRow = rows[0] as Record<string, unknown>;
        for (const key of ['ServiceName', 'SpanName', 'group', 'series']) {
          if (key in firstRow) {
            const groups = new Set(
              rows.map(r => String((r as Record<string, unknown>)[key])),
            );
            groupCount = groups.size;
            break;
          }
        }
      }

      return {
        success: true,
        hasData,
        rowCount: rows.length,
        groupCount,
        sampleRows: rows.slice(0, 5),
      };
    } catch {
      return { success: true, hasData: content.text.length > 0 };
    }
  }
}

/** Extract the content text and isError flag from an MCP JSON-RPC or SSE response. */
function extractMcpContent(
  text: string,
): { text: string; isError: boolean } | null {
  // Try JSON-RPC
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) {
      return {
        text: parsed.error.message ?? JSON.stringify(parsed.error),
        isError: true,
      };
    }
    const result = parsed?.result;
    if (result) {
      return {
        text: result.content?.[0]?.text ?? '',
        isError: result.isError === true,
      };
    }
  } catch {
    // Not JSON — try SSE
  }

  const lines = text.split('\n').filter(l => l.startsWith('data: '));
  for (const line of lines) {
    try {
      const data = JSON.parse(line.slice(6));
      if (data?.error) {
        return {
          text: data.error.message ?? JSON.stringify(data.error),
          isError: true,
        };
      }
      const result = data?.result;
      if (result) {
        return {
          text: result.content?.[0]?.text ?? '',
          isError: result.isError === true,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export type HyperdxDashboard = {
  /** v2 API returns `id`; internal API returns `_id`. */
  id: string;
  _id?: string;
  name: string;
  tags?: string[];
  tiles: Array<{
    /** v2 API always returns `id`. */
    id: string;
    _id?: string;
    name: string;
    config: Record<string, unknown>;
    containerId?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }>;
};

/** Query result with sample rows for LLM judge evaluation. */
export type TileQueryEvidence = {
  success: boolean;
  hasData: boolean;
  error?: string;
  rowCount?: number;
  groupCount?: number;
  sampleRows?: unknown[];
};
