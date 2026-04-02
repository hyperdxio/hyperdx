/**
 * Must be the very first import in cli.tsx so it runs before
 * any common-utils code calls console.debug/warn/error.
 *
 * Exports the original methods so --verbose can restore them.
 * When --verbose is enabled, logs are written to ~/.config/hyperdx/cli/debug.log
 * since Ink takes over stdout/stderr in TUI mode.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const _origDebug = console.debug;
export const _origWarn = console.warn;
export const _origError = console.error;

const LOG_DIR = path.join(os.homedir(), '.config', 'hyperdx', 'cli');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

let logStream: fs.WriteStream | null = null;

function getLogStream(): fs.WriteStream {
  if (!logStream) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  }
  return logStream;
}

function fileLog(level: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args
    .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  getLogStream().write(`[${ts}] [${level}] ${msg}\n`);
}

/** Enable verbose logging to file */
export function enableVerboseFileLogging() {
  // Truncate the log file on each new session
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, '');

  console.debug = (...args: unknown[]) => fileLog('DEBUG', ...args);
  console.warn = (...args: unknown[]) => fileLog('WARN', ...args);
  console.error = (...args: unknown[]) => fileLog('ERROR', ...args);
}

export const DEBUG_LOG_PATH = LOG_FILE;

console.debug = () => {};
console.warn = () => {};
console.error = () => {};
