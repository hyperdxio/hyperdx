import { buildInFilterCondition } from '../sqlFilters';

describe('buildInFilterCondition', () => {
  it('builds an IN condition for a regular service name', () => {
    expect(buildInFilterCondition('ServiceName', 'checkout-service')).toBe(
      "ServiceName IN ('checkout-service')",
    );
  });

  it('escapes quotes in service names', () => {
    expect(buildInFilterCondition('ServiceName', "O'Reilly API")).toBe(
      "ServiceName IN ('O\\'Reilly API')",
    );
  });
});
