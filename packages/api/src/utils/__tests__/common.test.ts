import ms from 'ms';

import { convertMsToGranularityString } from '@/utils/common';

describe('utils/common', () => {
  it('convertMsToGranularityString', () => {
    // 30 second is the min granularity
    expect(convertMsToGranularityString(ms('1s'))).toEqual('30 second');
    expect(convertMsToGranularityString(ms('30'))).toEqual('30 second');
    expect(convertMsToGranularityString(ms('1m'))).toEqual('1 minute');
    expect(convertMsToGranularityString(ms('5m'))).toEqual('5 minute');
    expect(convertMsToGranularityString(ms('10m'))).toEqual('10 minute');
    expect(convertMsToGranularityString(ms('15m'))).toEqual('15 minute');
    expect(convertMsToGranularityString(ms('30m'))).toEqual('30 minute');
    expect(convertMsToGranularityString(ms('60 minute'))).toEqual('1 hour');
    expect(convertMsToGranularityString(ms('2h'))).toEqual('2 hour');
    expect(convertMsToGranularityString(ms('6h'))).toEqual('6 hour');
    expect(convertMsToGranularityString(ms('12h'))).toEqual('12 hour');
    expect(convertMsToGranularityString(ms('1d'))).toEqual('1 day');
    expect(convertMsToGranularityString(ms('2d'))).toEqual('2 day');
    expect(convertMsToGranularityString(ms('7d'))).toEqual('7 day');
    expect(convertMsToGranularityString(ms('30d'))).toEqual('30 day');
    // 30 day is the max granularity
    expect(convertMsToGranularityString(ms('1y'))).toEqual('30 day');
  });
});
