import { blindAnswer } from '../grading/blind';

describe('blindAnswer', () => {
  it('redacts mcp__hyperdx__ tool prefix', () => {
    const out = blindAnswer('I called mcp__hyperdx__hyperdx_query to find...');
    expect(out).not.toContain('mcp__hyperdx__');
    expect(out).toContain('mcp__redacted__');
  });

  it('redacts mcp__clickhouse__ tool prefix', () => {
    const out = blindAnswer('Used mcp__clickhouse__run_query to look up...');
    expect(out).not.toContain('mcp__clickhouse__');
    expect(out).toContain('mcp__redacted__');
  });

  it('replaces specific HyperDX tool names with a generic placeholder', () => {
    const out = blindAnswer(
      'I issued hyperdx_query and used hyperdx_list_sources to discover sources.',
    );
    expect(out).not.toMatch(/hyperdx_query|hyperdx_list_sources/);
    expect(out).toContain('mcp_query');
  });

  it('replaces specific ClickHouse tool names with a generic placeholder', () => {
    const out = blindAnswer(
      'Ran run_query, list_tables, and list_databases to introspect.',
    );
    expect(out).not.toMatch(/run_query|list_tables|list_databases/);
    expect(out).toContain('mcp_query');
  });

  it('redacts brand mentions HyperDX MCP and ClickHouse MCP', () => {
    const a = blindAnswer('Using HyperDX MCP I confirmed...');
    const b = blindAnswer('Using ClickHouse MCP I confirmed...');
    expect(a).toContain('MCP A');
    expect(b).toContain('MCP B');
    expect(a).not.toContain('HyperDX MCP');
    expect(b).not.toContain('ClickHouse MCP');
  });

  it('preserves data references that are part of the answer', () => {
    const answer =
      'Root cause: payment-service db.payment.connect timeout. ' +
      'Affected users hit checkout-api 5xx.';
    const out = blindAnswer(answer);
    expect(out).toContain('payment-service');
    expect(out).toContain('db.payment.connect');
    expect(out).toContain('checkout-api');
  });
});
