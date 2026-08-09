import { z } from 'zod';

import {
  MAX_ALERT_CHANNELS,
  validateAlertChannelSelection,
  zAlertChannels,
} from '@/types';

const refine = (input: Parameters<typeof validateAlertChannelSelection>[0]) => {
  const issues: z.ZodIssue[] = [];
  const ctx = {
    addIssue: (issue: z.ZodIssue) => issues.push(issue),
    path: [],
  } as unknown as z.RefinementCtx;
  validateAlertChannelSelection(input, ctx);
  return issues;
};

describe('alert channel schemas', () => {
  const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

  it('zAlertChannels accepts 1..MAX_ALERT_CHANNELS entries', () => {
    expect(zAlertChannels.safeParse([wh('a')]).success).toBe(true);
    expect(
      zAlertChannels.safeParse(
        Array.from({ length: MAX_ALERT_CHANNELS }, (_, i) => wh(`w${i}`)),
      ).success,
    ).toBe(true);
    expect(zAlertChannels.safeParse([]).success).toBe(false);
    expect(
      zAlertChannels.safeParse(
        Array.from({ length: MAX_ALERT_CHANNELS + 1 }, (_, i) => wh(`w${i}`)),
      ).success,
    ).toBe(false);
  });

  it('requires exactly one of channel / channels', () => {
    expect(refine({ channel: wh('a') })).toHaveLength(0);
    expect(refine({ channels: [wh('a')] })).toHaveLength(0);
    expect(refine({})).toHaveLength(1);
    expect(refine({ channel: wh('a'), channels: [wh('b')] })).toHaveLength(1);
  });

  it('rejects duplicate channels', () => {
    expect(refine({ channels: [wh('a'), wh('a')] })).toHaveLength(1);
    expect(refine({ channels: [wh('a'), wh('b')] })).toHaveLength(0);
  });
});
