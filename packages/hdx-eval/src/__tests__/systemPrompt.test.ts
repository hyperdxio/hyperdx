import { buildSystemPrompt } from '../harness/systemPrompt';

describe('buildSystemPrompt', () => {
  it('includes scenario-specific table names', () => {
    const p = buildSystemPrompt('error-root-cause', 'hyperdx');
    expect(p).toContain('default.eval_error_root_cause_otel_traces');
    expect(p).toContain('default.eval_error_root_cause_otel_logs');
  });

  it('includes generic tool-environment guidance for both MCPs', () => {
    const hdx = buildSystemPrompt('latency-spike', 'hyperdx');
    const ch = buildSystemPrompt('noisy-signals', 'clickhouse');
    // Both prompts should explain tool environment and Read availability
    for (const p of [hdx, ch]) {
      expect(p).toContain('TOOL ENVIRONMENT');
      expect(p).toContain('Read tool');
      expect(p).toContain('oversized tool responses');
    }
  });

  it('asks for service, operation, root cause, and ruled-out section', () => {
    const p = buildSystemPrompt('error-root-cause', 'clickhouse');
    expect(p.toLowerCase()).toContain('service');
    expect(p.toLowerCase()).toContain('operation');
    expect(p.toLowerCase()).toContain('root cause');
    expect(p.toLowerCase()).toContain("what's not the cause");
  });
});
