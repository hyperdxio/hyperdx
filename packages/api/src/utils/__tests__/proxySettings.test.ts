import { clampMaxExecutionTime } from '@/utils/proxySettings';

const BOUNDS = { defaultSeconds: 60, ceilingSeconds: 800 };

const clamp = (query: string, bounds = BOUNDS): string | null => {
  const params = new URLSearchParams(query);
  clampMaxExecutionTime(params, bounds);
  return params.get('max_execution_time');
};

describe('clampMaxExecutionTime', () => {
  // The case that caused the incident: no setting at all, so the query ran to
  // whatever the ClickHouse deployment allowed.
  it('applies the default when the client sends no timeout', () => {
    expect(clamp('query_id=abc')).toBe('60');
  });

  it('lowers a timeout above the ceiling', () => {
    expect(clamp('max_execution_time=5000')).toBe('800');
  });

  // A team may configure a long timeout, so a value between the default and the
  // ceiling has to survive untouched.
  it.each(['61', '180', '800'])('honours the requested timeout %p', value => {
    expect(clamp(`max_execution_time=${value}`)).toBe(value);
  });

  it('leaves a timeout below the default alone', () => {
    expect(clamp('max_execution_time=10')).toBe('10');
  });

  // 0 means unlimited to ClickHouse, which is precisely what must not survive.
  it.each(['0', '-1', 'unlimited', '', 'NaN'])(
    'imposes the ceiling for the unusable value %p',
    value => {
      expect(clamp(`max_execution_time=${value}`)).toBe('800');
    },
  );

  it('accepts a fractional timeout', () => {
    expect(clamp('max_execution_time=1.5')).toBe('1.5');
  });

  it('preserves the other query settings', () => {
    const params = new URLSearchParams('query_id=abc&readonly=2');
    clampMaxExecutionTime(params, BOUNDS);

    expect(params.get('query_id')).toBe('abc');
    expect(params.get('readonly')).toBe('2');
  });

  // A bad env value must not pin every query to a nonsense timeout.
  it.each([0, -5, Number.NaN])(
    'sends no timeout when the default is unusable (%p)',
    defaultSeconds => {
      expect(clamp('query_id=abc', { ...BOUNDS, defaultSeconds })).toBeNull();
    },
  );

  it.each([0, -5, Number.NaN])(
    'does not cap when the ceiling is unusable (%p)',
    ceilingSeconds => {
      expect(
        clamp('max_execution_time=5000', { ...BOUNDS, ceilingSeconds }),
      ).toBe('5000');
    },
  );
});
