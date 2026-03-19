/**
 * Opens $EDITOR with a temp file containing the current time range.
 * The user edits the file, saves, and we parse the result back.
 *
 * File format:
 *   # HyperDX Time Range
 *   # Edit the start and end times below. Supports:
 *   #   - ISO 8601:  2026-03-18T05:00:00Z
 *   #   - Relative:  now-1h, now-30m, now-24h, now-7d
 *   #   - Date only: 2026-03-18 (interpreted as start of day UTC)
 *   #
 *   # Lines starting with # are ignored.
 *
 *   start: 2026-03-18T04:00:00.000Z
 *   end:   2026-03-18T05:00:00.000Z
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

export interface TimeRange {
  start: Date;
  end: Date;
}

function formatDate(d: Date): string {
  return d.toISOString();
}

function buildFileContent(range: TimeRange): string {
  return [
    '# HyperDX Time Range',
    '# Edit the start and end times below. Supports:',
    '#   - ISO 8601:  2026-03-18T05:00:00Z',
    '#   - Relative:  now-1h, now-30m, now-24h, now-7d',
    '#   - Date only: 2026-03-18 (interpreted as start of day UTC)',
    '#',
    '# Lines starting with # are ignored.',
    '',
    `start: ${formatDate(range.start)}`,
    `end:   ${formatDate(range.end)}`,
    '',
  ].join('\n');
}

/**
 * Parse a time string that can be:
 *  - ISO 8601: "2026-03-18T05:00:00Z"
 *  - Relative: "now-1h", "now-30m", "now-24h", "now-7d", "now"
 *  - Date only: "2026-03-18"
 */
function parseTimeValue(value: string): Date | null {
  const trimmed = value.trim();

  // Relative time: now, now-1h, now-30m, etc.
  if (trimmed.startsWith('now')) {
    const now = Date.now();
    if (trimmed === 'now') return new Date(now);
    const match = trimmed.match(/^now-(\d+)(s|m|h|d|w)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      const ms: Record<string, number> = {
        s: 1000,
        m: 60_000,
        h: 3_600_000,
        d: 86_400_000,
        w: 604_800_000,
      };
      return new Date(now - n * (ms[unit] ?? 3_600_000));
    }
    return null;
  }

  // Try parsing as ISO / date string
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  return null;
}

function parseFileContent(content: string): TimeRange | null {
  let start: Date | null = null;
  let end: Date | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    const startMatch = trimmed.match(/^start:\s*(.+)$/i);
    if (startMatch) {
      start = parseTimeValue(startMatch[1]);
    }

    const endMatch = trimmed.match(/^end:\s*(.+)$/i);
    if (endMatch) {
      end = parseTimeValue(endMatch[1]);
    }
  }

  if (start && end && start < end) {
    return { start, end };
  }
  return null;
}

/**
 * Opens $EDITOR (or vi) with the current time range.
 * Returns the edited time range, or null if cancelled / invalid.
 *
 * This is a blocking call — Ink's render loop pauses while the editor
 * is open, which is the desired behavior (like git commit).
 */
export function openEditorForTimeRange(
  currentRange: TimeRange,
): TimeRange | null {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const tmpFile = path.join(os.tmpdir(), `hdx-timerange-${Date.now()}.txt`);

  try {
    fs.writeFileSync(tmpFile, buildFileContent(currentRange), 'utf-8');

    // Open editor — this blocks until the user saves and exits
    execSync(`${editor} ${tmpFile}`, {
      stdio: 'inherit', // Inherit stdin/stdout/stderr so the editor works
    });

    const edited = fs.readFileSync(tmpFile, 'utf-8');
    return parseFileContent(edited);
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}
