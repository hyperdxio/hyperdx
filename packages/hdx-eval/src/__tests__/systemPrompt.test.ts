import { buildSystemPrompt } from '../harness/systemPrompt';

describe('buildSystemPrompt', () => {
  it('includes scenario-specific table names', () => {
    const p = buildSystemPrompt('error-root-cause');
    expect(p).toContain('default.eval_error_root_cause_otel_traces');
    expect(p).toContain('default.eval_error_root_cause_otel_logs');
  });

  it('includes generic tool-environment guidance', () => {
    const p1 = buildSystemPrompt('latency-spike');
    const p2 = buildSystemPrompt('noisy-signals');
    // Both prompts should explain tool environment and Read availability
    for (const p of [p1, p2]) {
      expect(p).toContain('TOOL ENVIRONMENT');
      expect(p).toContain('Read tool');
      expect(p).toContain('oversized tool responses');
    }
  });

  it('asks for service, operation, root cause, and ruled-out section', () => {
    const p = buildSystemPrompt('error-root-cause');
    expect(p.toLowerCase()).toContain('service');
    expect(p.toLowerCase()).toContain('operation');
    expect(p.toLowerCase()).toContain('root cause');
    expect(p.toLowerCase()).toContain("what's not the cause");
  });

  it('includes anchor time when provided', () => {
    const p = buildSystemPrompt('error-root-cause', '2026-01-15T10:00:00.000Z');
    expect(p).toContain('FIXED CURRENT TIME');
    expect(p).toContain('2026-01-15T10:00:00.000Z');
  });

  it('includes hypothesis playbook when variant is hypothesis', () => {
    const p = buildSystemPrompt('error-root-cause', undefined, 'hypothesis');
    expect(p).toContain('INVESTIGATION GUIDANCE');
    expect(p).toContain('hypotheses');
  });
});
