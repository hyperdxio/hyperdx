import { promqlStep } from '@/core/promql';

describe('promqlStep', () => {
  it('converts a granularity to a step', () => {
    expect(promqlStep('15 second')).toBe('15s');
    expect(promqlStep('5 minute')).toBe('300s');
    expect(promqlStep('1 day')).toBe('86400s');
    expect(promqlStep('7 day')).toBe('604800s');
  });

  it('defaults to a minute when the granularity is absent or unknown', () => {
    expect(promqlStep(undefined)).toBe('60s');
    expect(promqlStep('auto')).toBe('60s');
    expect(promqlStep('3 fortnights')).toBe('60s');
  });
});
