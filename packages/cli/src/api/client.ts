/**
 * HTTP client for the HyperDX internal API.
 *
 * Handles session cookie auth and exposes:
 *  - REST calls (login, sources, connections, me)
 *  - A ClickHouse node client that routes through /clickhouse-proxy
 *    with session cookies and connection-id header injection
 */

import { ClickHouseLogLevel, createClient } from '@clickhouse/client';
import type {
  BaseResultSet,
  ClickHouseClient as NodeClickHouseClient,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client';

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
import {
  AlertThresholdType,
  MetricTable,
  Tile,
  UseTextIndex,
} from '@hyperdx/common-utils/dist/types';

// ------------------------------------------------------------------
// API Client (session management + REST calls)
// ------------------------------------------------------------------

interface ApiClientOptions {
  appUrl: string;
  /**
   * Active team ID. When set, the client sends an `x-hdx-team` header on
   * every REST and ClickHouse-proxy request so the server scopes data
   * to that team. If not provided, the client picks up `activeTeamId`
   * from the saved session (if any).
   */
  activeTeamId?: string;
}

export class ApiClient {
  private appUrl: string;
  private apiUrl: string;
  private cookies: string[] = [];
  private activeTeamId: string | undefined;

  constructor(opts: ApiClientOptions) {
    this.appUrl = opts.appUrl.replace(/\/+$/, '');
    this.apiUrl = `${this.appUrl}/api`;

    const saved = loadSession();
    if (saved && saved.appUrl === this.appUrl) {
      this.cookies = saved.cookies;
      this.activeTeamId = saved.activeTeamId;
    }

    // Explicit option overrides the saved session.
    if (opts.activeTeamId !== undefined) {
      this.activeTeamId = opts.activeTeamId;
    }
  }

  getAppUrl(): string {
    return this.appUrl;
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  getCookieHeader(): string {
    return this.cookies.join('; ');
  }

  getActiveTeamId(): string | undefined {
    return this.activeTeamId;
  }

  /**
   * Update the active team for subsequent requests.
   *
   * NOTE: this only updates the in-memory client. Use
   * `setActiveTeam()` from `@/utils/config` to persist the choice
   * across CLI invocations.
   */
  setActiveTeamId(teamId: string | undefined): void {
    this.activeTeamId = teamId;
  }

  // ---- Auth --------------------------------------------------------

  /**
   * Attempt to log in.  Returns `null` on success or a human-readable
   * error string on failure so callers can display a meaningful message.
   */
  async login(email: string, password: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiUrl}/login/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        redirect: 'manual',
      });

      if (res.status === 200 || res.status === 302 || res.status === 303) {
        this.extractCookies(res);

        // Verify the session is actually valid — some servers return
        // 302/200 without setting a real session (e.g. SSO redirects).
        if (!(await this.checkSession())) {
          return 'Login succeeded but the session is not valid. The server may require SSO.';
        }

        // Reset active team on a fresh login — the previous selection
        // may not apply to the newly authenticated user.
        this.activeTeamId = undefined;
        saveSession({
          appUrl: this.appUrl,
          cookies: this.cookies,
          activeTeamId: undefined,
        });
        return null; // success
      }

      if (res.status === 401 || res.status === 403) {
        return 'Invalid email or password.';
      }

      // Try to extract a message from the response body
      let detail = '';
      try {
        const body = await res.text();
        if (body) {
          try {
            const json = JSON.parse(body);
            detail = json.message || json.error || '';
          } catch {
            // Not JSON — use raw body if short enough
            if (body.length < 200) detail = body;
          }
        }
      } catch {
        // ignore body read errors
      }

      return detail
        ? `Login failed (HTTP ${res.status}): ${detail}`
        : `Login failed (HTTP ${res.status}). Check your server URL and credentials.`;
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Unknown network error';
      return `Could not reach the server: ${msg}`;
    }
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

  /**
   * Returns all teams the authenticated user belongs to.
   *
   * On multi-team deployments (HyperDX Cloud / EE) `/api/me` returns a
   * `teams` array; we normalize it here. On single-team OSS deployments
   * `teams` is absent, so we fall back to a single-element array
   * containing the user's only team.
   */
  async getUserTeams(): Promise<MeTeam[]> {
    const me = await this.getMe();
    if (me.teams && me.teams.length > 0) {
      return me.teams.map(t => ({ id: t.id, name: t.name }));
    }
    return [{ id: me.team.id, name: me.team.name }];
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

  async getDashboards(): Promise<DashboardResponse[]> {
    const res = await this.get('/dashboards');
    if (!res.ok) throw new Error(`GET /dashboards failed: ${res.status}`);
    return res.json() as Promise<DashboardResponse[]>;
  }

  async getAlerts(): Promise<AlertsResponse> {
    const res = await this.get('/alerts');
    if (!res.ok) throw new Error(`GET /alerts failed: ${res.status}`);
    return res.json() as Promise<AlertsResponse>;
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
    if (this.activeTeamId) {
      // Multi-team scoping: validated by the EE auth middleware. OSS
      // ignores the header (single-team only), so it's safe to send
      // unconditionally when the user has picked a team.
      h['x-hdx-team'] = this.activeTeamId;
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
    // Derive the clickhouse-proxy pathname from the API URL.
    // If apiUrl has a path (e.g. /api), the proxy path becomes /api/clickhouse-proxy
    // so it works through the Next.js proxy at pages/api/[...all].ts.
    // Pass origin-only URL to createClient to prevent the path from being
    // interpreted as a ClickHouse database name.
    const apiUrlObj = new URL(apiClient.getApiUrl());
    const basePath = apiUrlObj.pathname.replace(/\/+$/, '');
    const chProxyPath = `${basePath}/clickhouse-proxy`;

    const baseHeaders: Record<string, string> = {
      cookie: apiClient.getCookieHeader(),
      // Force text/plain so Express's body parsers keep req.body as a
      // string. Without this, the proxy's proxyReq.write(req.body) fails
      // because express.json() parses the body into an Object.
      'content-type': 'text/plain',
    };
    const activeTeamId = apiClient.getActiveTeamId();
    if (activeTeamId) {
      baseHeaders['x-hdx-team'] = activeTeamId;
    }

    this.client = createClient({
      url: apiUrlObj.origin,
      pathname: chProxyPath,
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
      http_headers: baseHeaders,
      keep_alive: { enabled: false },
      // Silence the client's internal logger. Its DefaultLogger writes
      // via console.error at WARN level, and Ink's patchConsole re-routes
      // console output into the TUI — so aborted in-flight queries
      // (normal when tiles unmount or a time range changes) would spew
      // stack traces over the UI despite silenceLogs.
      log: { level: ClickHouseLogLevel.OFF },
    });
  }

  // This subclass always builds a node client, so narrow the base class's
  // platform-agnostic client type to the node-specific one.
  protected getClient(): NodeClickHouseClient {
    return super.getClient() as NodeClickHouseClient;
  }

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
      const neutralSettings = await this.processClickhouseSettings({
        connectionId,
        externalClickhouseSettings,
      });
      // processClickhouseSettings returns the shared base class's settings type
      // (from @clickhouse/client-common). It is structurally identical to the
      // node client's own self-bundled ClickHouseSettings, but the two packages'
      // copies are distinct nominal types since 1.23, so bridge explicitly.

      clickhouseSettings = neutralSettings as ClickHouseSettings;
    }

    // Pass connection ID as HTTP header — the proxy uses this to
    // look up the ClickHouse connection credentials from MongoDB
    const httpHeaders: Record<string, string> = {};
    if (connectionId && connectionId !== 'local') {
      httpHeaders['x-hyperdx-connection-id'] = connectionId;
    }
    // Re-send the active team header per-query so a mid-session team
    // change on the apiClient is picked up immediately. (The constructor-
    // level http_headers above only reflect the team at client creation.)
    const activeTeamId = this.apiClient.getActiveTeamId();
    if (activeTeamId) {
      httpHeaders['x-hdx-team'] = activeTeamId;
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

export interface MeTeam {
  id: string;
  name: string;
}

interface MeResponse {
  accessKey: string;
  createdAt: string;
  email: string;
  id: string;
  name: string;
  team: MeTeam & { apiKey: string };
  /**
   * All teams the user belongs to. Present on multi-team deployments
   * (HyperDX Cloud / EE). Absent on OSS, where the user always belongs
   * to a single team — callers should fall back to `[team]`.
   */
  teams?: MeTeam[];
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
  useTextIndexForImplicitColumn?: UseTextIndex;
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
  /** Trace sampling weight expression (used as chart sampleWeightExpression) */
  sampleRateExpression?: string;

  // Metric-specific: metric kind -> table name (gauge/sum/histogram/...)
  metricTables?: MetricTable;

  // Correlated source IDs
  logSourceId?: string;
  traceSourceId?: string;
  metricSourceId?: string;
  sessionSourceId?: string;
}

interface ConnectionResponse {
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

/**
 * A dashboard tile as returned by the internal API. `config` is the full
 * SavedChartConfig union (builder / raw SQL / PromQL) from common-utils.
 * Stored documents may carry legacy extra fields, hence the index signature
 * escape hatch on top of the typed shape.
 */
type DashboardTile = Tile;

interface DashboardFilter {
  key: string;
  displayName?: string;
  keyExpression?: string;
  sourceId?: string;
}

export interface DashboardResponse {
  id: string;
  _id: string;
  name: string;
  tags: string[];
  tiles: DashboardTile[];
  filters?: DashboardFilter[];
  savedQuery?: string | null;
  savedQueryLanguage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// ---- Alerts --------------------------------------------------------

export interface AlertHistoryItem {
  counts: number;
  createdAt: string;
  lastValues: Array<{ startTime: string; count: number }>;
  state: 'ALERT' | 'OK' | 'INSUFFICIENT_DATA' | 'DISABLED';
}

export interface AlertItem {
  _id: string;
  interval: string;
  scheduleOffsetMinutes?: number;
  scheduleStartAt?: string | null;
  threshold: number;
  thresholdType: AlertThresholdType;
  channel: { type?: string | null };
  state?: 'ALERT' | 'OK' | 'INSUFFICIENT_DATA' | 'DISABLED';
  source?: 'saved_search' | 'tile';
  dashboardId?: string;
  savedSearchId?: string;
  tileId?: string;
  name?: string | null;
  message?: string | null;
  createdAt: string;
  updatedAt: string;
  history: AlertHistoryItem[];
  dashboard?: {
    _id: string;
    name: string;
    updatedAt: string;
    tags: string[];
    tiles: Array<{ id: string; config: { name?: string } }>;
  };
  savedSearch?: {
    _id: string;
    createdAt: string;
    name: string;
    updatedAt: string;
    tags: string[];
  };
  createdBy?: {
    email: string;
    name?: string;
  };
  silenced?: {
    by: string;
    at: string;
    until: string;
  };
}

interface AlertsResponse {
  data: AlertItem[];
}
