import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hyperdx', 'cli');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

export interface SessionConfig {
  appUrl: string;
  cookies: string[];
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

export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch {
    // ignore
  }
}
