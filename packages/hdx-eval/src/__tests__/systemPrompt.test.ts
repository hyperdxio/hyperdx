import { buildSystemPrompt } from '../harness/systemPrompt';

describe('buildSystemPrompt', () => {
  it('includes scenario-specific table names', () => {
    const p = buildSystemPrompt('error-root-cause', 'hyperdx');
    expect(p).toContain('default.eval_error_root_cause_otel_traces');
    expect(p).toContain('default.eval_error_root_cause_otel_logs');
  });

  it('hints HyperDX MCP tools when condition is hyperdx', () => {
    const p = buildSystemPrompt('latency-spike', 'hyperdx');
    // The prompt now ships a small tools catalog so the agent doesn't have
    // to ToolSearch every tool by name. The catalog covers list_sources,
    // describe_source, and the four investigation tools we want the agent
    // to know about.
    expect(p).toContain('hyperdx_list_sources');
    expect(p).toContain('hyperdx_describe_source');
    expect(p).toContain('hyperdx_event_deltas');
    expect(p).toContain('hyperdx_log_patterns');
    expect(p).not.toContain('run_query');
  });

  it('hints ClickHouse MCP tools when condition is clickhouse', () => {
    const p = buildSystemPrompt('noisy-signals', 'clickhouse');
    expect(p).toContain('run_query');
    expect(p).toContain('list_tables');
    expect(p).not.toContain('hyperdx_query');
  });

  it('asks for service, operation, and root cause in the final answer', () => {
    const p = buildSystemPrompt('error-root-cause', 'clickhouse');
    expect(p.toLowerCase()).toContain('service');
    expect(p.toLowerCase()).toContain('operation');
    expect(p.toLowerCase()).toContain('root cause');
  });
});
