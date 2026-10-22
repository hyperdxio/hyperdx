import { z } from 'zod';

import {
  AlertSchema,
  checkAlertChannelSelection,
  MAX_ALERT_CHANNELS,
  SavedChartConfigSchema,
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

// checkAlertChannelSelection is the Zod-independent rule that
// validateAlertChannelSelection (below) wraps, and that the MCP tool's
// hand-rolled validator (packages/api/src/mcp/tools/alerts/schemas.ts) calls
// directly. Covering it here pins the classification both callers depend on.
describe('checkAlertChannelSelection', () => {
  const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

  it('returns ok when exactly one of channel / channels is provided', () => {
    expect(checkAlertChannelSelection({ channel: wh('a') })).toEqual({
      ok: true,
    });
    expect(checkAlertChannelSelection({ channels: [wh('a')] })).toEqual({
      ok: true,
    });
  });

  it('returns "missing" when neither is provided', () => {
    expect(checkAlertChannelSelection({})).toEqual({
      ok: false,
      code: 'missing',
    });
  });

  it('returns "mismatch" when channel disagrees with channels[0]', () => {
    expect(
      checkAlertChannelSelection({ channel: wh('a'), channels: [wh('b')] }),
    ).toEqual({ ok: false, code: 'mismatch' });
  });

  it('returns ok when channel agrees with channels[0]', () => {
    expect(
      checkAlertChannelSelection({
        channel: wh('a'),
        channels: [wh('a'), wh('b')],
      }),
    ).toEqual({ ok: true });
  });

  it('returns "duplicate" when channels contains a repeated entry', () => {
    expect(
      checkAlertChannelSelection({ channels: [wh('a'), wh('a')] }),
    ).toEqual({ ok: false, code: 'duplicate' });
  });
});

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

  it('requires at least one of channel / channels', () => {
    expect(refine({ channel: wh('a') })).toHaveLength(0);
    expect(refine({ channels: [wh('a')] })).toHaveLength(0);
    expect(refine({})).toHaveLength(1);
  });

  // Responses carry both fields, so a GET-then-PUT client echoes both back.
  it('accepts channel + channels when they agree, rejects a mismatch', () => {
    expect(
      refine({ channel: wh('a'), channels: [wh('a'), wh('b')] }),
    ).toHaveLength(0);
    expect(refine({ channel: wh('a'), channels: [wh('b')] })).toHaveLength(1);
    expect(refine({ channel: wh('a'), channels: [] })).toHaveLength(1);
  });

  it('rejects duplicate channels', () => {
    expect(refine({ channels: [wh('a'), wh('a')] })).toHaveLength(1);
    expect(refine({ channels: [wh('a'), wh('b')] })).toHaveLength(0);
  });

  // This repo only defines a webhook channel, but a downstream fork's wider
  // union (e.g. an `email` variant with `emailRecipients`, no `webhookId`)
  // must not collapse to the same key just because it's not webhook-shaped.
  it('keys non-webhook-shaped channels on their full contents, not webhookId', () => {
    const email = (recipients: string[]) => ({
      type: 'email',
      emailRecipients: recipients,
    });

    // Two distinct email channels both have `webhookId: undefined` -- a
    // webhookId-based key would collide them as duplicates.
    expect(
      refine({ channels: [email(['a@x.com']), email(['b@x.com'])] }),
    ).toHaveLength(0);
    // A real duplicate (same recipients) is still caught.
    expect(
      refine({ channels: [email(['a@x.com']), email(['a@x.com'])] }),
    ).toHaveLength(1);

    // A genuine disagreement between `channel` and `channels[0]` must not
    // read as agreement just because both are webhookId-less.
    expect(
      refine({
        channel: email(['a@x.com']),
        channels: [email(['b@x.com'])],
      }),
    ).toHaveLength(1);
    expect(
      refine({
        channel: email(['a@x.com']),
        channels: [email(['a@x.com'])],
      }),
    ).toHaveLength(0);
  });
});

// Tile alerts are validated through the saved-chart-config schema, not the
// API's alertSchema, so the "must have a target" rule has to hold here too --
// an alert saved with no channel fires and notifies nobody.
describe('tile alerts embedded in a saved chart config', () => {
  const tile = (alert: Record<string, unknown>) => ({
    name: 'Tile',
    displayType: 'line',
    connection: '65f5e4a3b9e77c001a789012',
    source: '65f5e4a3b9e77c001a789013',
    select: [],
    where: '',
    whereLanguage: 'lucene',
    alert,
  });

  const baseAlert = {
    threshold: 1,
    thresholdType: 'above',
    interval: '5m',
  };

  it('rejects a tile alert with no channel and no channels', () => {
    expect(SavedChartConfigSchema.safeParse(tile(baseAlert)).success).toBe(
      false,
    );
  });

  it('accepts a tile alert with channels', () => {
    expect(
      SavedChartConfigSchema.safeParse(
        tile({
          ...baseAlert,
          channels: [{ type: 'webhook', webhookId: 'w1' }],
        }),
      ).success,
    ).toBe(true);
  });

  it('accepts a legacy tile alert with only the singular channel', () => {
    expect(
      SavedChartConfigSchema.safeParse(
        tile({ ...baseAlert, channel: { type: 'webhook', webhookId: 'w1' } }),
      ).success,
    ).toBe(true);
  });
});

// The rule above is exercised through a hand-built RefinementCtx; these drive
// it through a real parse, which is how the API actually reaches it.
describe('AlertSchema channel selection', () => {
  const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

  const savedSearchAlert = (channelFields: Record<string, unknown>) => ({
    source: 'saved_search',
    savedSearchId: '65f5e4a3b9e77c001a345678',
    interval: '5m',
    threshold: 1,
    thresholdType: 'above',
    ...channelFields,
  });

  const parse = (channelFields: Record<string, unknown>) =>
    AlertSchema.safeParse(savedSearchAlert(channelFields)).success;

  it('accepts either field alone, and both when they agree', () => {
    expect(parse({ channel: wh('a') })).toBe(true);
    expect(parse({ channels: [wh('a'), wh('b')] })).toBe(true);
    expect(parse({ channel: wh('a'), channels: [wh('a'), wh('b')] })).toBe(
      true,
    );
  });

  it('rejects the invalid combinations', () => {
    expect(parse({})).toBe(false);
    expect(parse({ channel: wh('a'), channels: [wh('b')] })).toBe(false);
    expect(parse({ channels: [wh('a'), wh('a')] })).toBe(false);
    expect(parse({ channels: [] })).toBe(false);
    expect(
      parse({
        channels: Array.from({ length: MAX_ALERT_CHANNELS + 1 }, (_, i) =>
          wh(`w${i}`),
        ),
      }),
    ).toBe(false);
  });
});
