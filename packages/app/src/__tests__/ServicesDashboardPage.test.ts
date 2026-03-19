import { buildInFilterCondition } from '../ServicesDashboardPage';

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
});
