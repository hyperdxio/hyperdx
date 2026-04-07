// ─── Source/connection summary helpers ───────────────────────────────────────

export function buildSourceSummary(
  sources: { _id: unknown; name: string; kind: string }[],
  connections: { _id: unknown; name: string }[],
): string {
  if (sources.length === 0 && connections.length === 0) {
    return 'No sources or connections found. Call hyperdx_list_sources to discover available data.';
  }

  const lines: string[] = [];

  if (sources.length > 0) {
    lines.push('AVAILABLE SOURCES (use sourceId with builder tiles):');
    for (const s of sources) {
      lines.push(`  - "${s.name}" (${s.kind}) — sourceId: "${s._id}"`);
    }
  }

  if (connections.length > 0) {
    lines.push('');
    lines.push(
      'AVAILABLE CONNECTIONS (use connectionId with raw SQL tiles only):',
    );
    for (const c of connections) {
      lines.push(`  - "${c.name}" — connectionId: "${c._id}"`);
    }
  }

  return lines.join('\n');
}

export function getFirstSourceId(
  sources: { _id: unknown; kind: string }[],
  preferredKind?: string,
): string {
  const preferred = preferredKind
    ? sources.find(s => s.kind === preferredKind)
    : undefined;
  const source = preferred ?? sources[0];
  return source ? String(source._id) : '<SOURCE_ID>';
}

export function getFirstConnectionId(connections: { _id: unknown }[]): string {
  return connections[0] ? String(connections[0]._id) : '<CONNECTION_ID>';
}
