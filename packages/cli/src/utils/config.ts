import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hyperdx', 'cli');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

export interface SessionConfig {
  apiUrl: string;
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
    return JSON.parse(data) as SessionConfig;
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
