import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hyperdx', 'cli');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

export interface SessionConfig {
  appUrl: string;
  cookies: string[];
  /**
   * Active team ID for multi-team users. When set, the CLI sends an
   * `x-hdx-team` header on every API/ClickHouse-proxy request so the
   * server scopes data to that team. Persisted across CLI invocations
   * so the user doesn't have to re-pick on every command.
   *
   * Only meaningful when the deployment supports multi-team membership
   * (e.g. HyperDX Cloud / EE). On single-team OSS deployments this is
   * either undefined or set to the only team's ID.
   */
  activeTeamId?: string;
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveSession(config: SessionConfig): void {
  ensureConfigDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function loadSession(): SessionConfig | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = fs.readFileSync(SESSION_FILE, 'utf-8');
    const raw = JSON.parse(data) as Record<string, unknown>;

    // Migrate legacy sessions that only have apiUrl (no appUrl).
    // Old sessions stored the API URL directly; new sessions store
    // the app URL and derive the API URL by appending '/api'.
    if (!raw.appUrl && typeof raw.apiUrl === 'string') {
      raw.appUrl = raw.apiUrl.replace(/\/api\/?$/, '');
      delete raw.apiUrl;
      const migrated = raw as unknown as SessionConfig;
      saveSession(migrated);
      return migrated;
    }

    return raw as unknown as SessionConfig;
  } catch {
    return null;
  }
}

/**
 * Update the saved session's active team without touching cookies or appUrl.
 * Pass `undefined` to clear the active team.
 *
 * No-op if there's no saved session.
 */
export function setActiveTeam(activeTeamId: string | undefined): void {
  const session = loadSession();
  if (!session) return;
  saveSession({ ...session, activeTeamId });
}

export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch {
    // ignore
  }
}
