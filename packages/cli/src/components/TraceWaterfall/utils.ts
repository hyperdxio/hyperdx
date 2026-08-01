import type { SpanNode } from './types';

// ---- Duration formatting -------------------------------------------

export function durationMs(
  durationRaw: number,
  precision: number | undefined,
): number {
  const p = precision ?? 3;
  if (p === 9) return durationRaw / 1_000_000;
  if (p === 6) return durationRaw / 1_000;
  return durationRaw;
}

export function formatDuration(
  durationRaw: number,
  precision: number | undefined,
): string {
  const ms = durationMs(durationRaw, precision);
  if (ms === 0) return '0ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(1)}μs`;
  return `${(ms * 1_000_000).toFixed(0)}ns`;
}

// ---- Status helpers ------------------------------------------------

export function getStatusLabel(node: SpanNode): string {
  if (node.kind === 'log') {
    const sev = node.StatusCode?.toLowerCase();
    if (sev === 'error' || sev === 'fatal' || sev === 'critical') return 'ERR';
    if (sev === 'warn' || sev === 'warning') return 'WARN';
    return '';
  }
  if (node.StatusCode === '2' || node.StatusCode === 'Error') return 'ERR';
  if (node.StatusCode === '1') return 'WARN';
  return '';
}

export function getStatusColor(node: SpanNode): 'red' | 'yellow' | undefined {
  if (node.kind === 'log') {
    const sev = node.StatusCode?.toLowerCase();
    if (sev === 'error' || sev === 'fatal' || sev === 'critical') return 'red';
    if (sev === 'warn' || sev === 'warning') return 'yellow';
    return undefined;
  }
  if (node.StatusCode === '2' || node.StatusCode === 'Error') return 'red';
  if (node.StatusCode === '1') return 'yellow';
  return undefined;
}

export function getBarColor(node: SpanNode): string {
  if (node.kind === 'log') {
    const sev = node.StatusCode?.toLowerCase();
    if (sev === 'error' || sev === 'fatal' || sev === 'critical') return 'red';
    if (sev === 'warn' || sev === 'warning') return 'yellow';
    return 'green';
  }
  if (node.StatusCode === '2' || node.StatusCode === 'Error') return 'red';
  if (node.StatusCode === '1') return 'yellow';
  return 'cyan';
}

// ---- Bar rendering -------------------------------------------------

export function renderBar(
  startMs: number,
  durMs: number,
  minMs: number,
  maxMs: number,
  barWidth: number,
): string {
  const totalMs = maxMs - minMs;
  if (totalMs <= 0 || barWidth <= 0) return '';

  const startFrac = (startMs - minMs) / totalMs;
  const durFrac = durMs / totalMs;

  const startCol = Math.round(startFrac * barWidth);
  const barLen = Math.max(1, Math.round(durFrac * barWidth));
  const endCol = Math.min(startCol + barLen, barWidth);

  const leading = ' '.repeat(Math.max(0, startCol));
  const bar = '█'.repeat(Math.max(1, endCol - Math.max(0, startCol)));
  return (leading + bar).slice(0, barWidth);
}
