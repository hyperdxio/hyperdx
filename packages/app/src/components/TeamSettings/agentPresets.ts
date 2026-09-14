/**
 * Starting briefs for a managed agent, appended to the standing SRE prompt at
 * provisioning time.
 *
 * The value picked here is never stored, only the resulting text, so a preset
 * can be reworded or dropped without migrating anything. Each one is phrased
 * as "where to look first",
 * because the standing prompt already covers the method (investigate through
 * the ClickStack MCP server, change nothing in production) — a preset that
 * repeated that would just dilute it.
 */
export type AgentPreset = {
  value: string;
  label: string;
  instructions: string;
};

export const AGENT_PRESETS: AgentPreset[] = [
  {
    value: 'general',
    label: 'General responder',
    // The standing prompt is already a general SRE brief; adding to it here
    // would only repeat it.
    instructions: '',
  },
  {
    value: 'database',
    label: 'Database / ClickHouse',
    instructions: [
      'Specialise in the data layer. Look first at query latency and error',
      'rates against the database, then replication lag, merge and mutation',
      'backlogs, connection saturation and disk pressure. Call out slow or',
      'newly-changed queries by name, and say whether the symptom looks like',
      'load, a schema or query change, or the cluster itself.',
    ].join(' '),
  },
  {
    value: 'kubernetes',
    label: 'Kubernetes / infrastructure',
    instructions: [
      'Specialise in the platform layer. Look first at pod restarts, OOMKills,',
      'crashloops, failing probes and pending pods for the affected service,',
      'then node CPU/memory pressure and evictions. Check whether a rollout,',
      'scaling event or config change lines up with the onset.',
    ].join(' '),
  },
  {
    value: 'errors',
    label: 'Application errors',
    instructions: [
      'Specialise in application failures. Group the errors in the window by',
      'exception type, service and endpoint to find the dominant pattern,',
      'then follow a representative trace end to end to locate the failing',
      'call. Check whether the pattern is new and whether a deploy precedes',
      'it. Quote a representative log line or stack frame.',
    ].join(' '),
  },
  {
    value: 'latency',
    label: 'Latency / performance',
    instructions: [
      'Specialise in slowness. Compare p50/p95/p99 latency for the affected',
      'service and endpoint against the preceding period, then use traces to',
      'find which span or downstream dependency accounts for the increase.',
      'Distinguish a slower dependency from higher load or queueing, and say',
      'which.',
    ].join(' '),
  },
];

/** The blank-brief preset, used as the form's default. */
export const DEFAULT_AGENT_PRESET = AGENT_PRESETS[0];
