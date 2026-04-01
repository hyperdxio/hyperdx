/**
 * HTTP client for the HyperDX internal API.
 *
 * Handles session cookie auth and exposes:
 *  - REST calls (login, sources, connections, me)
 *  - A ClickHouse node client that routes through /clickhouse-proxy
 *    with session cookies and connection-id header injection
 */

import { createClient } from '@clickhouse/client';
import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client-common';

import {
  BaseClickhouseClient,
  type ClickhouseClientOptions,
  type QueryInputs,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  getMetadata,
  type Metadata,
} from '@hyperdx/common-utils/dist/core/metadata';

import { loadSession, saveSession, clearSession } from '@/utils/config';

// ------------------------------------------------------------------
// API Client (session management + REST calls)
// ------------------------------------------------------------------

export interface ApiClientOptions {
  apiUrl: string;
}

export class ApiClient {
  private apiUrl: string;
  private cookies: string[] = [];

  constructor(opts: ApiClientOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');

    const saved = loadSession();
    if (saved && saved.apiUrl === this.apiUrl) {
      this.cookies = saved.cookies;
    }
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  getCookieHeader(): string {
    return this.cookies.join('; ');
  }

  // ---- Auth --------------------------------------------------------

  async login(email: string, password: string): Promise<boolean> {
    const res = await fetch(`${this.apiUrl}/login/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    });

    if (res.status === 302 || res.status === 200) {
      this.extractCookies(res);
      saveSession({ apiUrl: this.apiUrl, cookies: this.cookies });
      return true;
    }

    return false;
  }

  async checkSession(): Promise<boolean> {
    try {
      const res = await this.get('/me');
      return res.ok;
    } catch {
      return false;
    }
  }

  logout(): void {
    this.cookies = [];
    clearSession();
  }

  // ---- Generic HTTP ------------------------------------------------

  async get(path: string): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      headers: this.headers(),
      redirect: 'manual',
    });
  }

  async post(path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
  }

  // ---- Typed API calls ---------------------------------------------

  async getMe(): Promise<MeResponse> {
    const res = await this.get('/me');
    if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
    return res.json() as Promise<MeResponse>;
  }

  async getSources(): Promise<SourceResponse[]> {
    const res = await this.get('/sources');
    if (!res.ok) throw new Error(`GET /sources failed: ${res.status}`);
    return res.json() as Promise<SourceResponse[]>;
  }

  async getConnections(): Promise<ConnectionResponse[]> {
    const res = await this.get('/connections');
    if (!res.ok) throw new Error(`GET /connections failed: ${res.status}`);
    return res.json() as Promise<ConnectionResponse[]>;
  }

  async getSavedSearches(): Promise<SavedSearchResponse[]> {
    const res = await this.get('/saved-searches');
    if (!res.ok) throw new Error(`GET /saved-searches failed: ${res.status}`);
    return res.json() as Promise<SavedSearchResponse[]>;
  }

  // ---- ClickHouse client via proxy ---------------------------------

  createClickHouseClient(
    opts: Partial<ClickhouseClientOptions> = {},
  ): ProxyClickhouseClient {
    return new ProxyClickhouseClient(this, opts);
  }

  createMetadata(opts: Partial<ClickhouseClientOptions> = {}): Metadata {
    return getMetadata(this.createClickHouseClient(opts));
  }

  // ---- Internal ----------------------------------------------------

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.cookies.length > 0) {
      h['cookie'] = this.cookies.join('; ');
    }
    return h;
  }

  private extractCookies(res: Response): void {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      this.cookies = setCookies.map(c => c.split(';')[0]);
    }
  }
}

// ------------------------------------------------------------------
// ClickHouse client that proxies through /clickhouse-proxy
// using the native Node @clickhouse/client with cookie auth
// ------------------------------------------------------------------

export class ProxyClickhouseClient extends BaseClickhouseClient {
  private apiClient: ApiClient;

  constructor(
    apiClient: ApiClient,
    opts: Partial<ClickhouseClientOptions> = {},
  ) {
    super({
      host: `${apiClient.getApiUrl()}/clickhouse-proxy`,
      ...opts,
    });
    this.apiClient = apiClient;

    // The @clickhouse/client treats the path portion of `url` as the
    // database name, NOT the HTTP path. Use `pathname` to set the proxy
    // path so requests go to http://<host>/clickhouse-proxy/?query=...
    this.client = createClient({
      url: apiClient.getApiUrl(),
      pathname: '/clickhouse-proxy',
      // No ClickHouse credentials — the proxy handles auth to ClickHouse.
      // We authenticate to the proxy via session cookie.
      username: '',
      password: '',
      // Disable the Authorization header — we auth via session cookie,
      // and a stray "Authorization: Basic Og==" (empty creds) causes
      // Express to reject the request before reading the session cookie.
      set_basic_auth_header: false,
      request_timeout: this.requestTimeout,
      application: 'hyperdx-tui',
      http_headers: {
        cookie: apiClient.getCookieHeader(),
        // Force text/plain so Express's body parsers keep req.body as a
        // string. Without this, the proxy's proxyReq.write(req.body) fails
        // because express.json() parses the body into an Object.
        'content-type': 'text/plain',
      },
      keep_alive: { enabled: false },
    });
  }

  // Silence the "Sending Query: ..." debug output from BaseClickhouseClient
  protected override logDebugQuery(): void {}

  protected async __query<Format extends DataFormat>({
    query,
    format = 'JSON' as Format,
    query_params = {},
    abort_signal,
    clickhouse_settings: externalClickhouseSettings,
    connectionId,
    queryId,
    shouldSkipApplySettings,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    let clickhouseSettings: ClickHouseSettings | undefined;
    if (!shouldSkipApplySettings) {
      clickhouseSettings = await this.processClickhouseSettings({
        connectionId,
        externalClickhouseSettings,
      });
    }

    // Pass connection ID as HTTP header — the proxy uses this to
    // look up the ClickHouse connection credentials from MongoDB
    const httpHeaders: Record<string, string> = {};
    if (connectionId && connectionId !== 'local') {
      httpHeaders['x-hyperdx-connection-id'] = connectionId;
    }

    return this.getClient().query({
      query,
      query_params,
      format,
      abort_signal,
      http_headers: httpHeaders,
      clickhouse_settings: clickhouseSettings,
      query_id: queryId,
    }) as unknown as Promise<BaseResultSet<ReadableStream, Format>>;
  }
}

// ------------------------------------------------------------------
// Response types (matching the internal API shapes)
// ------------------------------------------------------------------

export interface MeResponse {
  accessKey: string;
  createdAt: string;
  email: string;
  id: string;
  name: string;
  team: {
    id: string;
    name: string;
    apiKey: string;
  };
}

export interface SourceResponse {
  id: string;
  _id: string;
  name: string;
  kind: 'log' | 'trace' | 'session' | 'metric';
  connection: string;
  from: {
    databaseName: string;
    tableName: string;
  };
  timestampValueExpression?: string;
  displayedTimestampValueExpression?: string;
  defaultTableSelectExpression?: string;
  implicitColumnExpression?: string;
  orderByExpression?: string;
  querySettings?: Array<{ setting: string; value: string }>;

  // Log source-specific
  bodyExpression?: string;
  severityTextExpression?: string;
  serviceNameExpression?: string;

  // Trace-specific
  traceIdExpression?: string;
  spanIdExpression?: string;
  parentSpanIdExpression?: string;
  spanNameExpression?: string;
  spanKindExpression?: string;
  durationExpression?: string;
  durationPrecision?: number;
  statusCodeExpression?: string;
  statusMessageExpression?: string;
  eventAttributesExpression?: string;
  resourceAttributesExpression?: string;

  // Correlated source IDs
  logSourceId?: string;
  traceSourceId?: string;
  metricSourceId?: string;
  sessionSourceId?: string;
}

export interface ConnectionResponse {
  id: string;
  _id: string;
  name: string;
  host: string;
  username: string;
}

export interface SavedSearchResponse {
  id: string;
  _id: string;
  name: string;
  select: string;
  where: string;
  whereLanguage: 'lucene' | 'sql';
  source: string;
  tags: string[];
  orderBy?: string;
}
