import { formatDate } from '../utils';

describe('utils', () => {
  it('12h utc', () => {
    const date = new Date('2021-01-01T12:00:00Z');
    expect(
      formatDate(date, {
        clock: '12h',
        isUTC: true,
      }),
    ).toEqual('Jan 1 12:00:00 PM');
  });

  it('24h utc', () => {
    const date = new Date('2021-01-01T12:00:00Z');
    expect(
      formatDate(date, {
        clock: '24h',
        isUTC: true,
        format: 'withMs',
      }),
    ).toEqual('Jan 1 12:00:00.000');
  });

  it('12h local', () => {
    const date = new Date('2021-01-01T12:00:00');
    expect(
      formatDate(date, {
        clock: '12h',
        isUTC: false,
      }),
    ).toEqual('Jan 1 12:00:00 PM');
  });

  it('24h local', () => {
    const date = new Date('2021-01-01T12:00:00');
    expect(
      formatDate(date, {
        clock: '24h',
        isUTC: false,
        format: 'withMs',
      }),
    ).toEqual('Jan 1 12:00:00.000');
  });
});
