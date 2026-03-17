import { buildInFilterCondition } from '../ServicesDashboardPage';

function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function buildRandomString(length: number, seed = 3277): string {
  const random = createSeededRandom(seed);
  const charset =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-\'"';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(random() * charset.length);
    result += charset[index];
  }
  return result;
}

describe('buildInFilterCondition', () => {
  it.each([
    {
      columnExpression: 'ServiceName',
      value: 'checkout-service',
      expected: "ServiceName IN ('checkout-service')",
    },
    {
      columnExpression: "SpanAttributes['service.name']",
      value: "O'Reilly API",
      expected: "SpanAttributes['service.name'] IN ('O\\'Reilly API')",
    },
    {
      columnExpression: "ResourceAttributes['service.namespace']",
      value: 'payments "v2"',
      expected:
        "ResourceAttributes['service.namespace'] IN ('payments \\\"v2\\\"')",
    },
  ])(
    'escapes value and keeps column expression for $columnExpression',
    ({ columnExpression, value, expected }) => {
      expect(buildInFilterCondition(columnExpression, value)).toBe(expected);
    },
  );

  it('handles deterministic random values without breaking SQL formatting', () => {
    const randomColumn = "ResourceAttributes['deployment.environment']";
    const randomValue = buildRandomString(64);

    const condition = buildInFilterCondition(randomColumn, randomValue);

    expect(condition).toContain(`${randomColumn} IN (`);
    expect(condition).toMatch(/^.+ IN \('.*'\)$/);
    expect(condition).not.toContain("'')");
  });
});
