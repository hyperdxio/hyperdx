import { calculateInterval, renderMs } from '../utils';

describe('renderMs', () => {
  it('formats sub-second values as ms', () => {
    expect(renderMs(500)).toBe('500ms');
    expect(renderMs(999)).toBe('999ms');
  });

  it('rounds sub-second values', () => {
    expect(renderMs(999.4)).toBe('999ms');
    expect(renderMs(999.6)).toBe('1000ms');
  });

  it('formats whole seconds without decimals', () => {
    expect(renderMs(1000)).toBe('1s');
    expect(renderMs(2000)).toBe('2s');
    expect(renderMs(5000)).toBe('5s');
  });

  it('formats fractional seconds with three decimals', () => {
    expect(renderMs(1500)).toBe('1.500s');
    expect(renderMs(1234.567)).toBe('1.235s');
  });

  it('returns "0µs" for 0', () => {
    expect(renderMs(0)).toBe('0µs');
  });

  it('formats sub-millisecond values as µs', () => {
    expect(renderMs(0.001)).toBe('1µs');
    expect(renderMs(0.5)).toBe('500µs');
    expect(renderMs(0.999)).toBe('999µs');
  });

  it('rounds sub-millisecond values to nearest µs', () => {
    expect(renderMs(0.0005)).toBe('1µs');
    expect(renderMs(0.9994)).toBe('999µs');
  });

  it('falls through to ms when µs rounds to 1000', () => {
    // 0.9995ms rounds to 1000µs, so it should render as 1ms instead
    expect(renderMs(0.9995)).toBe('1ms');
  });
});

describe('calculateInterval', () => {
  it('returns 0.5 for value 5 (small values)', () => {
    expect(calculateInterval(5)).toBe(0.5);
  });

  it('returns magnitude 1 bucket for value 10', () => {
    expect(calculateInterval(10)).toBe(1);
  });

  it('returns 2x magnitude for value 25', () => {
    expect(calculateInterval(25)).toBe(2);
  });

  it('returns 5x magnitude for value 50', () => {
    expect(calculateInterval(50)).toBe(5);
  });

  it('returns magnitude 10 for value 100', () => {
    expect(calculateInterval(100)).toBe(10);
  });

  it('returns 2x10 for value 200', () => {
    expect(calculateInterval(200)).toBe(20);
  });

  it('returns 5x10 for value 500', () => {
    expect(calculateInterval(500)).toBe(50);
  });

  it('returns magnitude 100 for value 1000', () => {
    expect(calculateInterval(1000)).toBe(100);
  });
});
