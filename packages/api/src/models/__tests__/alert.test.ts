import { AlertChannel, getAlertChannels } from '@/models/alert';

// A channel type this repo doesn't define -- e.g. a downstream fork's email
// channel carrying an `emailRecipients` array. `value: any` (rather than an
// `as` cast) keeps this off the no-unsafe-type-assertion budget while still
// producing a value typed as AlertChannel for the calls below.
const foreignChannel = (value: any): AlertChannel => value;

describe('getAlertChannels', () => {
  const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

  it('prefers the channels array when present', () => {
    expect(
      getAlertChannels({ channel: wh('legacy'), channels: [wh('a'), wh('b')] }),
    ).toEqual([wh('a'), wh('b')]);
  });

  it('falls back to the legacy singular channel', () => {
    expect(getAlertChannels({ channel: wh('legacy') })).toEqual([wh('legacy')]);
    expect(getAlertChannels({ channel: wh('legacy'), channels: [] })).toEqual([
      wh('legacy'),
    ]);
  });

  it('returns empty for null-type or missing channels', () => {
    expect(getAlertChannels({ channel: { type: null } })).toEqual([]);
    expect(getAlertChannels({})).toEqual([]);
  });

  // The invariant guard: this repo only defines webhook channels, but a
  // downstream fork adds others. getAlertChannels must copy them by
  // reference, not project them onto webhook-shaped fields.
  it('copies a channels[] entry opaquely, preserving fields this repo does not define', () => {
    const exotic = foreignChannel({
      type: 'email',
      emailRecipients: ['ops@example.test'],
    });

    expect(getAlertChannels({ channels: [exotic] })).toEqual([exotic]);
  });

  it('copies the legacy singular channel opaquely when it is a foreign type', () => {
    const exotic = foreignChannel({
      type: 'email',
      emailRecipients: ['ops@example.test'],
    });

    expect(getAlertChannels({ channel: exotic })).toEqual([exotic]);
  });
});
