/**
 * Blind candidate answers before showing them to the judge so the judge
 * can't tell which MCP the agent used. We replace MCP-identifying tool
 * names and brand mentions with neutral placeholders. We do NOT touch
 * data references like `payment-service` or `database.query` — those
 * are part of the answer being graded.
 *
 * The blinding rules are derived from each MCP's `brandTerms` and
 * `toolPattern` in the config, so adding a new MCP automatically
 * gets its identity redacted.
 */

import type { McpDefinition, McpKind } from '@/harness/types';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type BlindingEntry = {
  kind: McpKind;
  def: McpDefinition;
  /** Anonymized label: "MCP A", "MCP B", etc. */
  anonLabel: string;
};

/**
 * Build blinding entries from a list of MCP names + definitions.
 * Assigns sequential anonymous labels: MCP A, MCP B, MCP C, ...
 */
export function buildBlindingEntries(
  mcps: Array<{ kind: McpKind; def: McpDefinition }>,
): BlindingEntry[] {
  return mcps.map((m, i) => ({
    ...m,
    anonLabel: `MCP ${String.fromCharCode(65 + i)}`,
  }));
}

/**
 * Blind an answer string by replacing MCP-identifying tool prefixes
 * and brand terms with anonymous labels.
 *
 * @param text   The candidate's final answer text.
 * @param entries Blinding entries built from `buildBlindingEntries()`.
 *               If omitted, no blinding is performed (passthrough).
 */
export function blindAnswer(text: string, entries?: BlindingEntry[]): string {
  if (!entries || entries.length === 0) return text;

  let result = text;
  for (const { kind, def, anonLabel } of entries) {
    // Replace tool prefix: `mcp__<kind>__` → `mcp__redacted__`
    const prefixRx = new RegExp(`\\bmcp__${escapeRegex(kind)}__`, 'gi');
    result = result.replace(prefixRx, 'mcp__redacted__');

    // Replace brand terms with the anonymous label.
    for (const term of def.brandTerms ?? []) {
      const termRx = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
      result = result.replace(termRx, anonLabel);
    }
  }
  return result;
}
