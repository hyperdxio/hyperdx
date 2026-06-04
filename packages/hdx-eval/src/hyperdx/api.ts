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
      throw new Error(
        `HyperDX API ${method} ${path} → ${res.status}: ${snippet}`,
      );
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
}
