import { buildSystemPrompt } from '@/harness/systemPrompt';
import { getScenario } from '@/scenarios';
import type { Scenario, SystemPromptContext } from '@/scenarios/types';

describe('buildSystemPrompt', () => {
  it('includes scenario-specific table names', () => {
    const p = buildSystemPrompt(getScenario('error-root-cause'));
    expect(p).toContain('default.eval_error_root_cause_otel_traces');
    expect(p).toContain('default.eval_error_root_cause_otel_logs');
  });

  it('includes generic tool-environment guidance', () => {
    const p1 = buildSystemPrompt(getScenario('latency-spike'));
    const p2 = buildSystemPrompt(getScenario('noisy-signals'));
    // Both prompts should explain tool environment and Read availability
    for (const p of [p1, p2]) {
      expect(p).toContain('TOOL ENVIRONMENT');
      expect(p).toContain('Read tool');
      expect(p).toContain('oversized tool responses');
    }
  });

  it('asks for service, operation, root cause, and ruled-out section', () => {
    const p = buildSystemPrompt(getScenario('error-root-cause'));
    expect(p.toLowerCase()).toContain('service');
    expect(p.toLowerCase()).toContain('operation');
    expect(p.toLowerCase()).toContain('root cause');
    expect(p.toLowerCase()).toContain("what's not the cause");
  });

  it('includes anchor time when provided', () => {
    const p = buildSystemPrompt(
      getScenario('error-root-cause'),
      '2026-01-15T10:00:00.000Z',
    );
    expect(p).toContain('FIXED CURRENT TIME');
    expect(p).toContain('2026-01-15T10:00:00.000Z');
  });

  it('warns that describe_source value samples may be stale (with anchor)', () => {
    const p = buildSystemPrompt(
      getScenario('error-root-cause'),
      '2026-01-15T10:00:00.000Z',
    );
    expect(p).toContain('DATA DISCOVERY CAVEAT');
    expect(p).toContain('clickstack_describe_source');
    expect(p).toContain('lowCardinalityValues');
  });

  it('omits the sampling caveat when no anchor is provided', () => {
    const p = buildSystemPrompt(getScenario('error-root-cause'));
    expect(p).not.toContain('DATA DISCOVERY CAVEAT');
  });

  it('includes the sampling caveat in the dashboard prompt when anchored', () => {
    const p = buildSystemPrompt(
      getScenario('dashboard-build'),
      '2026-01-15T10:00:00.000Z',
    );
    expect(p).toContain('DATA DISCOVERY CAVEAT');
    expect(p).toContain('lowCardinalityValues');
  });

  it('includes hypothesis playbook when variant is hypothesis', () => {
    const p = buildSystemPrompt(
      getScenario('error-root-cause'),
      undefined,
      'hypothesis',
    );
    expect(p).toContain('INVESTIGATION GUIDANCE');
    expect(p).toContain('hypotheses');
  });

  it('uses custom buildSystemPrompt hook when provided', () => {
    const customPrompt = 'You are a custom scenario agent.';
    const fakeScenario: Scenario = {
      ...getScenario('error-root-cause'),
      buildSystemPrompt: (_ctx: SystemPromptContext) => customPrompt,
    };
    const p = buildSystemPrompt(fakeScenario);
    expect(p).toBe(customPrompt);
    // Should NOT contain investigation-specific content
    expect(p).not.toContain("What's not the cause");
  });

  it('uses custom system prompt for dashboard scenarios', () => {
    const p = buildSystemPrompt(getScenario('dashboard-build'));
    expect(p).toContain('building');
    expect(p).toContain('dashboards');
    expect(p).toContain('TURN BUDGET');
    // Should NOT contain investigation-specific content
    expect(p).not.toContain("What's not the cause");
    // Should be minimal — no workflow coaching or tool-specific instructions
    expect(p.length).toBeLessThan(500);
  });
});
