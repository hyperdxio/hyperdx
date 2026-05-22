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
    // Both prompts should warn that Read/Bash/Grep are unavailable
    for (const p of [hdx, ch]) {
      expect(p).toContain('TOOL ENVIRONMENT');
      expect(p).toContain('NO');
      expect(p).toContain('file-reading tools');
    }
  });

  it('asks for service, operation, and root cause in the final answer', () => {
    const p = buildSystemPrompt('error-root-cause', 'clickhouse');
    expect(p.toLowerCase()).toContain('service');
    expect(p.toLowerCase()).toContain('operation');
    expect(p.toLowerCase()).toContain('root cause');
  });
});
