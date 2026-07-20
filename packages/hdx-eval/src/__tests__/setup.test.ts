import { nometricsGrantStatements } from '@/hyperdx/setup';
import { SCENARIO_NAMES } from '@/scenarios';

describe('nometricsGrantStatements', () => {
  const statements = nometricsGrantStatements();

  it('emits CREATE USER + wildcard GRANT + one REVOKE per metric table', () => {
    // 5 base otel_metrics_* tables + 5 eval metric tables per scenario.
    expect(statements).toHaveLength(2 + 5 + SCENARIO_NAMES.length * 5);
    expect(statements[0]).toBe(
      "CREATE USER IF NOT EXISTS hdx_eval_nometrics IDENTIFIED WITH plaintext_password BY 'hdx_eval_nometrics'",
    );
    expect(statements[1]).toBe(
      'GRANT SELECT ON default.* TO hdx_eval_nometrics',
    );
    for (const stmt of statements.slice(2)) {
      expect(stmt).toMatch(
        /^REVOKE SELECT ON default\.(eval_\w+_)?otel_metrics_\w+ FROM hdx_eval_nometrics$/,
      );
    }
  });

  it('revokes SELECT on every metric-saturation metric table', () => {
    expect(statements).toContain(
      'REVOKE SELECT ON default.eval_metric_saturation_otel_metrics_gauge FROM hdx_eval_nometrics',
    );
    expect(statements).toContain(
      'REVOKE SELECT ON default.eval_metric_saturation_otel_metrics_exponential_histogram FROM hdx_eval_nometrics',
    );
    expect(statements).toContain(
      'REVOKE SELECT ON default.otel_metrics_gauge FROM hdx_eval_nometrics',
    );
  });

  it('mentions the user in every statement and honors overrides', () => {
    for (const stmt of statements) {
      expect(stmt).toContain('hdx_eval_nometrics');
    }
    const custom = nometricsGrantStatements('other_user', 'pw');
    expect(custom[0]).toBe(
      "CREATE USER IF NOT EXISTS other_user IDENTIFIED WITH plaintext_password BY 'pw'",
    );
    expect(custom.every(s => s.includes('other_user'))).toBe(true);
  });
});
