import {
  blindAnswer,
  type BlindingEntry,
  buildBlindingEntries,
} from '../grading/blind';
import type { McpDefinition } from '../harness/types';

const hyperdxDef: McpDefinition = {
  type: 'http',
  url: 'http://localhost/mcp',
  toolPattern: 'mcp__hyperdx__*',
  label: 'HyperDX',
  brandTerms: ['HyperDX', 'hyperdx'],
};

const clickhouseDef: McpDefinition = {
  type: 'stdio',
  command: 'uv',
  toolPattern: 'mcp__clickhouse__*',
  label: 'ClickHouse MCP',
  brandTerms: ['ClickHouse MCP', 'clickhouse'],
};

const entries: BlindingEntry[] = buildBlindingEntries([
  { kind: 'hyperdx', def: hyperdxDef },
  { kind: 'clickhouse', def: clickhouseDef },
]);

describe('blindAnswer', () => {
  it('returns text unchanged when no entries are provided', () => {
    const text = 'I called mcp__hyperdx__hyperdx_query to find...';
    expect(blindAnswer(text)).toBe(text);
    expect(blindAnswer(text, [])).toBe(text);
  });

  it('redacts mcp__hyperdx__ tool prefix', () => {
    const out = blindAnswer(
      'I called mcp__hyperdx__hyperdx_query to find...',
      entries,
    );
    expect(out).not.toContain('mcp__hyperdx__');
    expect(out).toContain('mcp__redacted__');
  });

  it('redacts mcp__clickhouse__ tool prefix', () => {
    const out = blindAnswer(
      'Used mcp__clickhouse__run_query to look up...',
      entries,
    );
    expect(out).not.toContain('mcp__clickhouse__');
    expect(out).toContain('mcp__redacted__');
  });

  it('replaces HyperDX brand mentions with anonymous label', () => {
    const out = blindAnswer('Using HyperDX I confirmed the issue...', entries);
    expect(out).toContain('MCP A');
    expect(out).not.toContain('HyperDX');
  });

  it('replaces ClickHouse MCP brand mentions with anonymous label', () => {
    const out = blindAnswer('Using ClickHouse MCP I confirmed...', entries);
    expect(out).toContain('MCP B');
    expect(out).not.toContain('ClickHouse MCP');
  });

  it('preserves data references that are part of the answer', () => {
    const answer =
      'Root cause: payment-service db.payment.connect timeout. ' +
      'Affected users hit checkout-api 5xx.';
    const out = blindAnswer(answer, entries);
    expect(out).toContain('payment-service');
    expect(out).toContain('db.payment.connect');
    expect(out).toContain('checkout-api');
  });

  it('assigns sequential labels: MCP A, MCP B, MCP C, ...', () => {
    const threeEntries = buildBlindingEntries([
      { kind: 'alpha', def: { ...hyperdxDef, brandTerms: ['AlphaMCP'] } },
      { kind: 'beta', def: { ...clickhouseDef, brandTerms: ['BetaMCP'] } },
      {
        kind: 'gamma',
        def: {
          ...hyperdxDef,
          toolPattern: 'mcp__gamma__*',
          brandTerms: ['GammaMCP'],
        },
      },
    ]);
    expect(threeEntries[0].anonLabel).toBe('MCP A');
    expect(threeEntries[1].anonLabel).toBe('MCP B');
    expect(threeEntries[2].anonLabel).toBe('MCP C');

    const out = blindAnswer(
      'Used AlphaMCP and GammaMCP but not BetaMCP.',
      threeEntries,
    );
    expect(out).toContain('MCP A');
    expect(out).toContain('MCP C');
    expect(out).toContain('MCP B');
    expect(out).not.toMatch(/AlphaMCP|BetaMCP|GammaMCP/);
  });
});
