import { isNonTrivialSearch } from '@/OnboardingChecklist/onboardingTasks';

describe('isNonTrivialSearch', () => {
  it('is false for a blank search with no filters', () => {
    expect(isNonTrivialSearch('', [])).toBe(false);
    expect(isNonTrivialSearch('', undefined)).toBe(false);
  });

  it('is false for a whitespace-only where clause', () => {
    expect(isNonTrivialSearch('   ', [])).toBe(false);
  });

  it('is true for a non-empty where clause', () => {
    expect(isNonTrivialSearch('level:error', [])).toBe(true);
    expect(isNonTrivialSearch("StatusCode = 'Error'", undefined)).toBe(true);
  });

  it('is true when a filter is applied even with a blank where', () => {
    expect(isNonTrivialSearch('', [{ type: 'sql', condition: 'a = 1' }])).toBe(
      true,
    );
  });
});
