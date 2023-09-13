import { buildLogSearchLink, roundDownToXMinutes } from '../checkAlerts';

describe('checkAlerts', () => {
  it('roundDownToXMinutes', () => {
    // 1 min
    const roundDownTo1Minute = roundDownToXMinutes(1);
    expect(
      roundDownTo1Minute(new Date('2023-03-17T22:13:03.103Z')).toISOString(),
    ).toBe('2023-03-17T22:13:00.000Z');
    expect(
      roundDownTo1Minute(new Date('2023-03-17T22:13:59.103Z')).toISOString(),
    ).toBe('2023-03-17T22:13:00.000Z');

    // 5 mins
    const roundDownTo5Minutes = roundDownToXMinutes(5);
    expect(
      roundDownTo5Minutes(new Date('2023-03-17T22:13:03.103Z')).toISOString(),
    ).toBe('2023-03-17T22:10:00.000Z');
    expect(
      roundDownTo5Minutes(new Date('2023-03-17T22:17:59.103Z')).toISOString(),
    ).toBe('2023-03-17T22:15:00.000Z');
    expect(
      roundDownTo5Minutes(new Date('2023-03-17T22:59:59.103Z')).toISOString(),
    ).toBe('2023-03-17T22:55:00.000Z');
  });

  it('buildLogSearchLink', () => {
    expect(
      buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        logView: {
          _id: 123,
        } as any,
      }),
    ).toBe(
      'http://localhost:9090/search/123?from=1679091183103&to=1679091239103',
    );
    expect(
      buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        logView: {
          _id: 123,
        } as any,
        q: '🐱 foo:"bar"',
      }),
    ).toBe(
      'http://localhost:9090/search/123?from=1679091183103&to=1679091239103&q=%F0%9F%90%B1+foo%3A%22bar%22',
    );
  });
});
